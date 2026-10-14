/*
  Applies one hand-written migration file and records it.

  Why this exists: drizzle-kit builds its plan from drizzle/meta/*_snapshot.json.
  A hand-written .sql file has no matching snapshot, so `drizzle-kit migrate`
  decides there is nothing to do and exits 0 having applied nothing — a silent
  no-op, not an error.

  Usage: npx tsx scripts/apply-migration.ts drizzle/0007_checkout_support.sql
*/
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql, close, branch } from "./db";

const file = process.argv[2];

if (!file) {
  console.error("usage: npx tsx scripts/apply-migration.ts drizzle/<name>.sql");
  process.exit(1);
}

const contents = readFileSync(file, "utf8");
const hash = createHash("sha256").update(contents).digest("hex");

const [existing] = await sql<{ n: number }>(
  `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE hash = $1`,
  [hash],
);

if (Number(existing.n) > 0) {
  console.log(`${file}: already applied and recorded on ${branch()}`);
  await close();
  process.exit(0);
}

/*
  Split on breakpoints the way drizzle-kit does, but only on a marker at the
  START of a line.

  Matching the marker anywhere shreds SQL comments that merely quote it, and
  the resulting fragments are prose that is neither comment nor statement —
  which does not produce a clean syntax error, it produces a hang. That is
  what happened on the first run of this script.
*/
const MARKER = /^-->\s*statement-breakpoint\s*$/m;

function isCommentOnly(chunk: string): boolean {
  return chunk
    .split("\n")
    .every((line) => line.trim() === "" || line.trim().startsWith("--"));
}

const statements = contents
  .split(MARKER)
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  // Drop chunks that are purely comment text. A chunk whose last line is a
  // comment but whose body is SQL must be kept, so the test is on the whole
  // chunk, not on individual lines.
  .filter((s) => !isCommentOnly(s));

console.log(`applying ${file} to ${branch()}...`);
console.log(`  ${statements.length} statement(s)`);

let applied = 0;

for (const [index, statement] of statements.entries()) {
  const firstLine = statement.split("\n")[0].slice(0, 58);
  try {
    // No params argument: simple protocol, which accepts this statement.
    await sql(statement);
    applied++;
    console.log(`  [${index + 1}] ok   ${firstLine}`);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error(`  [${index + 1}] FAIL ${firstLine}`);
    console.error(`       ${e.code}: ${e.message?.split("\n")[0]}`);
    console.error(
      "\n  Every statement in these files is written idempotently, so re-running\n  this script after fixing the cause is safe.",
    );
    await close();
    process.exit(1);
  }
}

await sql(
  `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
  [hash, Date.now()],
);

const [verify] = await sql<{ n: number }>(
  `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE hash = $1`,
  [hash],
);

console.log(`\n${applied}/${statements.length} applied; recorded=${Number(verify.n) > 0}`);
await close();
