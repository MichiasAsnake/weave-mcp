import type { Pool, PoolClient } from "pg";
import fs from "node:fs";
import path from "node:path";

import { createPostgresPool } from "./connection.ts";

export const V2_ORCHESTRATOR_MIGRATIONS: string[] = [
  `
    create table if not exists v2_agent_sessions (
      session_id text primary key,
      request_id text not null,
      turn_id text not null,
      status text not null,
      request_mode text,
      registry_version text,
      user_request text not null,
      state_json jsonb not null,
      current_graph jsonb,
      latest_validation jsonb,
      latest_review jsonb,
      revision_count integer not null default 0,
      max_revision_count integer not null default 3,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `,
  `
    create table if not exists v2_graph_revisions (
      session_id text not null references v2_agent_sessions(session_id) on delete cascade,
      revision_index integer not null,
      graph_json jsonb not null,
      validation_json jsonb,
      review_json jsonb,
      note text,
      created_at timestamptz not null default now(),
      primary key (session_id, revision_index)
    );
  `,
  `
    create table if not exists v2_langgraph_checkpoints (
      thread_id text not null,
      checkpoint_ns text not null default '',
      checkpoint_id text not null,
      parent_checkpoint_id text,
      checkpoint_type text not null,
      checkpoint_blob bytea not null,
      metadata_type text not null,
      metadata_blob bytea not null,
      created_at timestamptz not null default now(),
      primary key (thread_id, checkpoint_ns, checkpoint_id)
    );
  `,
  `
    create table if not exists v2_langgraph_checkpoint_writes (
      thread_id text not null,
      checkpoint_ns text not null default '',
      checkpoint_id text not null,
      task_id text not null,
      write_idx integer not null,
      channel text not null,
      value_type text not null,
      value_blob bytea not null,
      created_at timestamptz not null default now(),
      primary key (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx),
      foreign key (thread_id, checkpoint_ns, checkpoint_id)
        references v2_langgraph_checkpoints(thread_id, checkpoint_ns, checkpoint_id)
        on delete cascade
    );
  `,
  `
    create index if not exists v2_agent_sessions_updated_at_idx
      on v2_agent_sessions(updated_at desc);
  `,
  `
    create index if not exists v2_graph_revisions_session_created_at_idx
      on v2_graph_revisions(session_id, created_at desc);
  `,
  `
    create index if not exists v2_langgraph_checkpoints_thread_created_at_idx
      on v2_langgraph_checkpoints(thread_id, checkpoint_ns, created_at desc);
  `,
];

export async function runV2OrchestratorMigrations(
  poolOrClient: Pool | PoolClient,
): Promise<void> {
  const client = "connect" in poolOrClient ? await poolOrClient.connect() : poolOrClient;
  const shouldRelease = "connect" in poolOrClient;

  try {
    await client.query("begin");
    for (const sql of V2_ORCHESTRATOR_MIGRATIONS) {
      await client.query(sql);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

function loadDotEnvLocalIfPresent(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotEnvLocalIfPresent();

  const pool = createPostgresPool();
  try {
    await runV2OrchestratorMigrations(pool);

    const tables = await pool.query<{
      table_name: string;
    }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'v2_agent_sessions',
            'v2_graph_revisions',
            'v2_langgraph_checkpoints',
            'v2_langgraph_checkpoint_writes'
          )
        order by table_name asc
      `,
    );

    console.log("[v2-db-migrations] ok");
    console.log(
      `[v2-db-migrations] tables=${tables.rows.map((row) => row.table_name).join(",")}`,
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("[v2-db-migrations] failed");
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
