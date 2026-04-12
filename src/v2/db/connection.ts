import { Pool } from "pg";

let sharedPool: Pool | null = null;

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the v2 orchestrator Postgres persistence layer.");
  }
  return databaseUrl;
}

export function createPostgresPool(connectionString: string = getDatabaseUrl()): Pool {
  const isLocal =
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1") ||
    connectionString.includes(".internal");

  return new Pool({
    connectionString,
    max: 10,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
}

export function getSharedPostgresPool(): Pool {
  if (!sharedPool) {
    sharedPool = createPostgresPool();
  }
  return sharedPool;
}

export async function closeSharedPostgresPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}
