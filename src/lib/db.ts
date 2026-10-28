import "server-only";
import postgres from "postgres";
import { env } from "./env";

// One shared connection pool for the whole server process.
// `prepare: false` keeps it compatible with Supabase's connection pooler.
const globalForDb = globalThis as unknown as { __yaxhaSql?: postgres.Sql };

export const sql: postgres.Sql =
  globalForDb.__yaxhaSql ??
  postgres(env.databaseUrl || "postgres://invalid", {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    idle_timeout: 20,
    onnotice: () => {},
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== "production") globalForDb.__yaxhaSql = sql;

export type Tx = postgres.TransactionSql;

/**
 * Runs `fn` inside a transaction as the restricted "yaxha_app" database role,
 * scoped to one user. Row Level Security then guarantees that every query in
 * `fn` can only read or change that user's rows.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    await tx`set local role yaxha_app`;
    return fn(tx);
  }) as Promise<T>;
}
