/*
  Minimal Postgres helper for standalone scripts (seed, verification).

  NOT the app's query layer — src/lib/queries.ts is. This exists because
  drizzle's `$inferInsert` maps a column's inputs to `never` when the column
  has a database default and no explicit type, which makes raw seed scripts
  fight the type system for no benefit. Scripts are one-off and run in CI.

  Returns rows directly, so callers write `const [row] = await sql(...)`.
*/
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local" });

/*
  UNPOOLED URL, deliberately.

  Scripts run DDL (CREATE INDEX, ALTER TABLE ... ADD CONSTRAINT), and DDL
  through Neon's PgBouncer in transaction mode HANGS — it does not error, it
  simply never returns. That cost two 5-minute timeouts before it was
  identified.

  Same reason drizzle.config.ts uses DATABASE_URL_UNPOOLED: DDL takes
  session-level locks that a transaction-mode pooler will not hand over.

  Application code uses the POOLED url (src/db/index.ts), which is correct for
  short request/response queries.
*/
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  max: 1,
  connectionTimeoutMillis: 15_000,
  // Without this a hung DDL hangs forever with no diagnostic.
  query_timeout: 30_000,
});

/*
  Default row type is `Record<string, any>` rather than `QueryResultRow`'s
  empty object: scripts index rows by column name, and `{}` rejects that with
  TS7053. Scripts are one-off and not part of the app's typed data layer.
*/
export type Row = Record<string, any>;

/*
  `params` is omitted entirely when not supplied, never defaulted to [].

  node-postgres chooses the wire protocol by argument shape: given a params
  array it uses the EXTENDED protocol, and Postgres refuses multiple statements
  inside a prepared statement. Given no params argument it uses the simple
  protocol, which is what lets a whole migration file run as a single string.

  Defaulting to [] is the trap: it silently switches protocols and breaks every
  multi-statement script for no visible reason.
*/
export async function sql<T extends Row = Row>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result =
    params === undefined
      ? await pool.query<T>(text)
      : await pool.query<T>(text, params);
  return result.rows;
}

export const close = () => pool.end();

export const branch = (): string => process.env.NEON_BRANCH ?? "unknown";
