import type { Pool } from "pg";

import type { GraphIR } from "../graph/types.ts";
import type {
  GraphHistoryEntry,
  OrchestratorState,
  OrchestratorStatus,
  OrchestratorReviewResult,
} from "../orchestrator/types.ts";
import type { ValidationResult } from "../validate/types.ts";

function sanitizeStateForPersistence<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStateForPersistence(item)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "registrySnapshot" && key !== "graphHistory")
      .map(([key, item]) => [key, sanitizeStateForPersistence(item)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

export interface PersistedOrchestratorSession {
  sessionId: string;
  requestId: string;
  turnId: string;
  status: OrchestratorStatus;
  requestMode?: OrchestratorState["requestMode"];
  registryVersion?: string;
  userRequest: string;
  state: OrchestratorState;
  currentGraph?: GraphIR;
  latestValidation?: ValidationResult;
  latestReview?: OrchestratorReviewResult;
  revisionCount: number;
  maxRevisionCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function loadOrchestratorSession(
  pool: Pool,
  sessionId: string,
): Promise<PersistedOrchestratorSession | null> {
  const { rows } = await pool.query<{
    session_id: string;
    request_id: string;
    turn_id: string;
    status: OrchestratorStatus;
    request_mode: OrchestratorState["requestMode"] | null;
    registry_version: string | null;
    user_request: string;
    state_json: OrchestratorState;
    current_graph: GraphIR | null;
    latest_validation: ValidationResult | null;
    latest_review: OrchestratorReviewResult | null;
    revision_count: number;
    max_revision_count: number;
    created_at: string;
    updated_at: string;
  }>(
    `
      select *
      from v2_agent_sessions
      where session_id = $1
      limit 1
    `,
    [sessionId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    sessionId: row.session_id,
    requestId: row.request_id,
    turnId: row.turn_id,
    status: row.status,
    requestMode: row.request_mode ?? undefined,
    registryVersion: row.registry_version ?? undefined,
    userRequest: row.user_request,
    state: row.state_json,
    currentGraph: row.current_graph ?? undefined,
    latestValidation: row.latest_validation ?? undefined,
    latestReview: row.latest_review ?? undefined,
    revisionCount: row.revision_count,
    maxRevisionCount: row.max_revision_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertOrchestratorSession(
  pool: Pool,
  state: OrchestratorState,
): Promise<void> {
  const stateToStore = sanitizeStateForPersistence(state);

  await pool.query(
    `
      insert into v2_agent_sessions (
        session_id,
        request_id,
        turn_id,
        status,
        request_mode,
        registry_version,
        user_request,
        state_json,
        current_graph,
        latest_validation,
        latest_review,
        revision_count,
        max_revision_count,
        created_at,
        updated_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7,
        $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
        $12, $13, $14, $15
      )
      on conflict (session_id)
      do update set
        request_id = excluded.request_id,
        turn_id = excluded.turn_id,
        status = excluded.status,
        request_mode = excluded.request_mode,
        registry_version = excluded.registry_version,
        user_request = excluded.user_request,
        state_json = excluded.state_json,
        current_graph = excluded.current_graph,
        latest_validation = excluded.latest_validation,
        latest_review = excluded.latest_review,
        revision_count = excluded.revision_count,
        max_revision_count = excluded.max_revision_count,
        updated_at = excluded.updated_at
    `,
    [
      state.sessionId,
      state.requestId,
      state.turnId,
      state.status,
      state.requestMode ?? null,
      state.registryVersion ?? null,
      state.userRequest,
      JSON.stringify(stateToStore),
      state.currentGraph ? JSON.stringify(state.currentGraph) : null,
      state.validationResult ? JSON.stringify(state.validationResult) : null,
      state.reviewResult ? JSON.stringify(state.reviewResult) : null,
      state.revisionCount,
      state.maxRevisionCount,
      state.checkpoints[0]?.recordedAt ?? new Date().toISOString(),
      new Date().toISOString(),
    ],
  );
}

export async function appendGraphRevision(
  pool: Pool,
  sessionId: string,
  revision: GraphHistoryEntry,
): Promise<void> {
  await pool.query(
    `
      insert into v2_graph_revisions (
        session_id,
        revision_index,
        graph_json,
        validation_json,
        review_json,
        note
      )
      values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
      on conflict (session_id, revision_index)
      do update set
        graph_json = excluded.graph_json,
        validation_json = excluded.validation_json,
        review_json = excluded.review_json,
        note = excluded.note
    `,
    [
      sessionId,
      revision.revisionIndex,
      JSON.stringify(revision.graph),
      revision.validationResult ? JSON.stringify(revision.validationResult) : null,
      revision.reviewResult ? JSON.stringify(revision.reviewResult) : null,
      revision.note ?? null,
    ],
  );
}

export async function loadGraphRevisions(
  pool: Pool,
  sessionId: string,
): Promise<GraphHistoryEntry[]> {
  const { rows } = await pool.query<{
    revision_index: number;
    graph_json: GraphIR;
    validation_json: ValidationResult | null;
    review_json: OrchestratorReviewResult | null;
    note: string | null;
    created_at: string;
  }>(
    `
      select *
      from v2_graph_revisions
      where session_id = $1
      order by revision_index asc
    `,
    [sessionId],
  );

  return rows.map((row) => ({
    revisionIndex: row.revision_index,
    graph: row.graph_json,
    validationResult: row.validation_json ?? undefined,
    reviewResult: row.review_json ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  }));
}
