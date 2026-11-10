import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Reuse one pool across dev hot reloads.
const g = globalThis as unknown as { pgClient?: postgres.Sql };
export const pgClient = g.pgClient ?? postgres(process.env.DATABASE_URL!, { max: 10 });
if (process.env.NODE_ENV !== "production") g.pgClient = pgClient;

export const db = drizzle(pgClient, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Postgres unique-constraint error for this constraint name (postgres.js error, possibly wrapped by Drizzle). */
export function isUniqueViolation(e: unknown, constraint: string) {
  const err = ((e as { cause?: unknown })?.cause ?? e) as { code?: string; constraint_name?: string };
  return err?.code === "23505" && err?.constraint_name === constraint;
}

/** Check ids from URLs before they reach a uuid column (a malformed id would be a 500, not a 404). */
export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
