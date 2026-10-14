import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import * as schema from "./schema";

/*
  One pool for the whole process, created lazily and reused.

  Next.js dev reloads modules constantly; a module-scope pool would open a new
  connection on every hot reload until Postgres refuses them. Lazy creation
  inside a getter avoids that, and the pool is cached on globalThis so the
  production runtime (which also re-evaluates modules) reuses the same one.
*/
const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

/*
  Transactional client access.

  Cart operations span several statements and must be atomic: taking a
  reservation, writing the cart line, and refreshing the expiry either all
  happen or none do. `sql.client()` hands out a dedicated connection so those
  statements share one session and can be wrapped in BEGIN/COMMIT.

  The pooled URL is NOT used here. PgBouncer in transaction mode hands a
  connection to one transaction at a time, so an explicit multi-statement
  transaction would see a DIFFERENT backend mid-flight — the second
  statement's writes would land somewhere the first cannot see.
*/
export async function client(): Promise<PoolClient> {
  return getPool().connect();
}

function getPool(): Pool {
  if (!globalForDb.pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Run `neon env pull` or `neon link`.",
      );
    }

    /*
      Pooled URL only. DATABASE_URL routes through Neon's PgBouncer in
      transaction mode, which caps concurrency for us. Migrations and DDL use
      DATABASE_URL_UNPOOLED instead — see drizzle.config.ts.

      max: 5 because this pool is shared by every request handler in the
      process. A higher max buys nothing on a single Neon's connection limit
      and just queues.
    */
    globalForDb.pool = new Pool({
      connectionString,
      max: 5,
      /*
        Fail fast rather than hang. Neon suspends a compute after 5 minutes
        idle, and waking it can exceed a short timeout — the request then dies
        with "Connection terminated due to connection timeout" and no useful
        diagnostic. 30s tolerates a cold start while still bounding the wait.
      */
      connectionTimeoutMillis: 30_000,
      /*
        Cap a single query. A runaway cart query would otherwise hold a pooled
        connection indefinitely, and with max 5 five such queries take the
        whole app down rather than degrading it.
      */
      query_timeout: 20_000,
      statement_timeout: 20_000,
    });
  }

  return globalForDb.pool;
}

export const db = drizzle(getPool(), { schema });
export { schema };
export type Database = typeof db;

/**
 * Raw text-SQL helper for statements drizzle's builder does not express well.
 *
 * Returns rows directly, so callers write `const [row] = await query(...)`.
 * Anything using $1 placeholders goes here rather than through the builder:
 * drizzle's template literals use its own param dialect, and mixing the two
 * is how a query silently runs with `undefined` bound.
 *
 * This borrows a connection per call, so it cannot be used inside an explicit
 * transaction. Use `client()` for those.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  /*
    Pass params as undefined when empty, never as [].

    node-postgres picks the wire protocol by argument shape: given a params
    array it uses the EXTENDED protocol, and Postgres refuses multiple
    statements in a prepared statement ("cannot insert multiple commands into
    a prepared statement"). Given no params it uses the simple protocol, which
    accepts a multi-statement string.

    This matters for DDL and for migrations, which batch statements into one
    string. Silently sending [] instead is how a multi-statement migration
    starts failing for no visible reason.
  */
  const result =
    params.length > 0
      ? await getPool().query<T>(text, params)
      : await getPool().query<T>(text);
  return result.rows;
}
