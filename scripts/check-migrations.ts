/*
  Reports which migration files exist, which are in the journal, and which are
  actually applied to the linked branch.

  Needed because drizzle-kit migrate SKIPS a hand-written .sql that has no
  journal entry — and skips it SILENTLY. No error, no warning, the migration
  just never runs. That cost an afternoon once, so it gets a script.

  Run: npx tsx scripts/check-migrations.ts
*/
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, close, branch } from "./db";

const MIGRATIONS_DIR = "drizzle";

type JournalEntry = { idx: number; tag: string };
type AppliedRow = { hash: string; created_at: number };

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
).entries as JournalEntry[];

const journalTags = new Set(journal.map((e) => `${e.tag}.sql`));

const applied = await sql<AppliedRow>(`
  SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
`);

console.log(`branch: ${branch()}\n`);
console.log(`migration files on disk : ${files.length}`);
console.log(`journal entries         : ${journal.length}`);
console.log(`applied on this branch  : ${applied.length}\n`);

let problems = 0;

console.log("--- files vs journal ---");
for (const file of files) {
  if (!journalTags.has(file)) {
    console.log(`  ORPHAN  ${file} — not in journal, drizzle-kit will SKIP it silently`);
    problems++;
  } else {
    console.log(`  ok      ${file}`);
  }
}

console.log("\n--- journal vs applied ---");
const appliedCount = applied.length;
const journalCount = journal.length;
if (appliedCount < journalCount) {
  console.log(
    `  ${journalCount - appliedCount} journal entr${journalCount - appliedCount === 1 ? "y" : "ies"} not applied yet — run \`npx drizzle-kit migrate\``,
  );
} else if (appliedCount > journalCount) {
  console.log(
    `  WARNING: ${appliedCount} applied but only ${journalCount} in journal. The branch has migrations this file does not know about.`,
  );
  problems++;
} else {
  console.log("  all journal entries applied");
}

console.log(`\n${problems === 0 ? "OK" : `${problems} problem(s) found`}`);
if (problems > 0) process.exitCode = 1;

await close();
