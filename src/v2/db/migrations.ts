import type { Pool, PoolClient } from "pg";

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
