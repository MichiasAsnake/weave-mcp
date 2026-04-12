import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId,
  maxChannelVersion,
  TASKS,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { Pool } from "pg";

function checkpointNamespaceFromConfig(config: RunnableConfig): string {
  return String(config.configurable?.checkpoint_ns ?? "");
}

function threadIdFromConfig(config: RunnableConfig): string {
  const threadId = config.configurable?.thread_id;
  if (!threadId) {
    throw new Error('RunnableConfig is missing required configurable.thread_id for checkpoint persistence.');
  }
  return String(threadId);
}

function checkpointIdFromConfig(config: RunnableConfig): string {
  const checkpointId = getCheckpointId(config);
  if (!checkpointId) {
    throw new Error('RunnableConfig is missing required configurable.checkpoint_id for checkpoint writes.');
  }
  return checkpointId;
}

function bufferToUint8Array(value: Buffer): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function sanitizeCheckpointValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCheckpointValue(item)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "registrySnapshot" && key !== "graphHistory")
      .map(([key, item]) => [key, sanitizeCheckpointValue(item)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

export class PostgresCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly pool: Pool) {
    super();
  }

  private async migratePendingSends(
    checkpoint: Checkpoint,
    threadId: string,
    checkpointNamespace: string,
    parentCheckpointId: string,
  ): Promise<void> {
    const { rows } = await this.pool.query<{
      channel: string;
      value_type: string;
      value_blob: Buffer;
    }>(
      `
        select channel, value_type, value_blob
        from v2_langgraph_checkpoint_writes
        where thread_id = $1
          and checkpoint_ns = $2
          and checkpoint_id = $3
          and channel = $4
        order by created_at asc
      `,
      [threadId, checkpointNamespace, parentCheckpointId, TASKS],
    );

    if (rows.length === 0) {
      return;
    }

    checkpoint.channel_values ??= {};
    checkpoint.channel_values[TASKS] = await Promise.all(
      rows.map((row) => this.serde.loadsTyped(row.value_type, bufferToUint8Array(row.value_blob))),
    );
    checkpoint.channel_versions ??= {};
    checkpoint.channel_versions[TASKS] =
      Object.keys(checkpoint.channel_versions).length > 0
        ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
        : this.getNextVersion(undefined);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = threadIdFromConfig(config);
    const checkpointNamespace = checkpointNamespaceFromConfig(config);
    const explicitCheckpointId = getCheckpointId(config);

    const query = explicitCheckpointId
      ? `
          select *
          from v2_langgraph_checkpoints
          where thread_id = $1
            and checkpoint_ns = $2
            and checkpoint_id = $3
          limit 1
        `
      : `
          select *
          from v2_langgraph_checkpoints
          where thread_id = $1
            and checkpoint_ns = $2
          order by checkpoint_id desc
          limit 1
        `;

    const values = explicitCheckpointId
      ? [threadId, checkpointNamespace, explicitCheckpointId]
      : [threadId, checkpointNamespace];

    const { rows } = await this.pool.query<{
      thread_id: string;
      checkpoint_ns: string;
      checkpoint_id: string;
      parent_checkpoint_id: string | null;
      checkpoint_type: string;
      checkpoint_blob: Buffer;
      metadata_type: string;
      metadata_blob: Buffer;
    }>(query, values);

    const row = rows[0];
    if (!row) {
      return undefined;
    }

    const checkpoint = await this.serde.loadsTyped(
      row.checkpoint_type,
      bufferToUint8Array(row.checkpoint_blob),
    );
    const metadata = await this.serde.loadsTyped(
      row.metadata_type,
      bufferToUint8Array(row.metadata_blob),
    );

    if (checkpoint.v < 4 && row.parent_checkpoint_id) {
      await this.migratePendingSends(
        checkpoint,
        row.thread_id,
        row.checkpoint_ns,
        row.parent_checkpoint_id,
      );
    }

    const pendingWrites = await this.readPendingWrites(
      row.thread_id,
      row.checkpoint_ns,
      row.checkpoint_id,
    );

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };

    if (row.parent_checkpoint_id) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }

    return tuple;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id
      ? String(config.configurable.thread_id)
      : undefined;
    const checkpointNamespace = config.configurable?.checkpoint_ns;

    const clauses: string[] = [];
    const values: unknown[] = [];

    if (threadId) {
      values.push(threadId);
      clauses.push(`thread_id = $${values.length}`);
    }

    if (checkpointNamespace !== undefined) {
      values.push(String(checkpointNamespace));
      clauses.push(`checkpoint_ns = $${values.length}`);
    }

    if (config.configurable?.checkpoint_id) {
      values.push(String(config.configurable.checkpoint_id));
      clauses.push(`checkpoint_id = $${values.length}`);
    }

    if (options?.before?.configurable?.checkpoint_id) {
      values.push(String(options.before.configurable.checkpoint_id));
      clauses.push(`checkpoint_id < $${values.length}`);
    }

    const limit = options?.limit ?? 100;
    values.push(limit);

    const whereSql = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const { rows } = await this.pool.query<{
      thread_id: string;
      checkpoint_ns: string;
      checkpoint_id: string;
      parent_checkpoint_id: string | null;
      checkpoint_type: string;
      checkpoint_blob: Buffer;
      metadata_type: string;
      metadata_blob: Buffer;
    }>(
      `
        select *
        from v2_langgraph_checkpoints
        ${whereSql}
        order by checkpoint_id desc
        limit $${values.length}
      `,
      values,
    );

    for (const row of rows) {
      const metadata = await this.serde.loadsTyped(
        row.metadata_type,
        bufferToUint8Array(row.metadata_blob),
      );

      if (
        options?.filter &&
        !Object.entries(options.filter).every(([key, value]) => metadata?.[key] === value)
      ) {
        continue;
      }

      const checkpoint = await this.serde.loadsTyped(
        row.checkpoint_type,
        bufferToUint8Array(row.checkpoint_blob),
      );
      if (checkpoint.v < 4 && row.parent_checkpoint_id) {
        await this.migratePendingSends(
          checkpoint,
          row.thread_id,
          row.checkpoint_ns,
          row.parent_checkpoint_id,
        );
      }

      const pendingWrites = await this.readPendingWrites(
        row.thread_id,
        row.checkpoint_ns,
        row.checkpoint_id,
      );

      yield {
        config: {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint,
        metadata,
        pendingWrites,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: row.thread_id,
                checkpoint_ns: row.checkpoint_ns,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
      };
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    preparedCheckpoint.channel_values = sanitizeCheckpointValue(preparedCheckpoint.channel_values ?? {});
    const threadId = threadIdFromConfig(config);
    const checkpointNamespace = checkpointNamespaceFromConfig(config);
    const parentCheckpointId = config.configurable?.checkpoint_id
      ? String(config.configurable.checkpoint_id)
      : null;

    const [serializedCheckpoint, serializedMetadata] = await Promise.all([
      this.serde.dumpsTyped(preparedCheckpoint),
      this.serde.dumpsTyped(metadata),
    ]);

    await this.pool.query(
      `
        insert into v2_langgraph_checkpoints (
          thread_id,
          checkpoint_ns,
          checkpoint_id,
          parent_checkpoint_id,
          checkpoint_type,
          checkpoint_blob,
          metadata_type,
          metadata_blob
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (thread_id, checkpoint_ns, checkpoint_id)
        do update set
          parent_checkpoint_id = excluded.parent_checkpoint_id,
          checkpoint_type = excluded.checkpoint_type,
          checkpoint_blob = excluded.checkpoint_blob,
          metadata_type = excluded.metadata_type,
          metadata_blob = excluded.metadata_blob
      `,
      [
        threadId,
        checkpointNamespace,
        preparedCheckpoint.id,
        parentCheckpointId,
        serializedCheckpoint[0],
        Buffer.from(serializedCheckpoint[1]),
        serializedMetadata[0],
        Buffer.from(serializedMetadata[1]),
      ],
    );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNamespace,
        checkpoint_id: preparedCheckpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = threadIdFromConfig(config);
    const checkpointNamespace = checkpointNamespaceFromConfig(config);
    const checkpointId = checkpointIdFromConfig(config);

    await Promise.all(
      writes.map(async ([channel, value], index) => {
        const [valueType, valueBlob] = await this.serde.dumpsTyped(sanitizeCheckpointValue(value));
        const writeIndex = WRITES_IDX_MAP[channel] ?? index;

        await this.pool.query(
          `
            insert into v2_langgraph_checkpoint_writes (
              thread_id,
              checkpoint_ns,
              checkpoint_id,
              task_id,
              write_idx,
              channel,
              value_type,
              value_blob
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            on conflict (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx)
            do nothing
          `,
          [
            threadId,
            checkpointNamespace,
            checkpointId,
            taskId,
            writeIndex,
            channel,
            valueType,
            Buffer.from(valueBlob),
          ],
        );
      }),
    );
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.pool.query("delete from v2_langgraph_checkpoints where thread_id = $1", [threadId]);
  }

  private async readPendingWrites(
    threadId: string,
    checkpointNamespace: string,
    checkpointId: string,
  ): Promise<CheckpointPendingWrite[]> {
    const { rows } = await this.pool.query<{
      task_id: string;
      channel: string;
      value_type: string;
      value_blob: Buffer;
    }>(
      `
        select task_id, channel, value_type, value_blob
        from v2_langgraph_checkpoint_writes
        where thread_id = $1
          and checkpoint_ns = $2
          and checkpoint_id = $3
        order by task_id asc, write_idx asc
      `,
      [threadId, checkpointNamespace, checkpointId],
    );

    return Promise.all(
      rows.map(async (row) => [
        row.task_id,
        row.channel,
        await this.serde.loadsTyped(row.value_type, bufferToUint8Array(row.value_blob)),
      ]),
    );
  }
}
