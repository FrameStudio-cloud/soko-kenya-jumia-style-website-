import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

/*
  drizzle.config.ts is loaded by drizzle-kit's own process, which does NOT
  read .env.local the way Next.js does. Without this line the migration runs
  with url: undefined and fails — the error names a missing param, never
  mentions env loading, so it reads like a config bug.
*/
config({ path: ".env.local" });

/*
  Migrations run against the UNPOOLED connection.
  This is not optional: Drizzle Kit issues session-level statements (SET,
  advisory locks, prepared statements) that fail through Neon's PgBouncer in
  transaction mode, and the failures never name pooling as the cause.
*/
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
  strict: true,
  verbose: true,
});
