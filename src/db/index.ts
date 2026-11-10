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
