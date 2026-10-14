/*
  Drizzle model vs the actual database.

  src/db/schema.ts is a hand-maintained description of the tables. It drifted
  once already: migration 0007 added delivery_address, delivery_phone,
  delivery_notes and expires_at to `orders` plus the whole order_status_history
  table, and placeOrder() writes all of them — while schema.ts declares none of
  it.

  Nothing broke, because every query in the app goes through raw pg rather than
  drizzle's builder. That is luck, not design: the moment anything builds a
  query from the drizzle model, it will believe a column that is not there or
  ignore one that is.

  This is the guard against that class of bug, not a patch for the one instance.
  It compares both directions, because both are failures:

    in the database, absent from schema  -> code cannot select or join it
    in schema, absent from the database  -> every query naming it errors

  Usage: npx tsx scripts/verify-schema-sync.ts
*/
import { getTableConfig } from "drizzle-orm/pg-core";
import { sql, close, branch } from "./db";

/*
  Imported as the live module rather than re-declared. A copy of the table list
  would itself drift, and would report the database as fine while disagreeing
  with the thing actually used at runtime.
*/
const { schema } = await import("@/db");

/*
  Membership is decided by asking drizzle, not by sniffing module exports.

  The schema module also exports relations, column helpers and relations config,
  none of which are tables. Rather than pattern-match on drizzle's internal
  symbol keys — which differ between versions — getTableConfig is asked, and it
  throws for anything that is not a table.
*/
const declared: Array<{ table: string; columns: Set<string> }> = [];

for (const value of Object.values(schema)) {
  try {
    const config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    declared.push({
      table: config.name,
      columns: new Set(config.columns.map((c) => c.name as string)),
    });
  } catch {
    // Not a table. Expected for relations, helpers and the like.
  }
}

declared.sort((a, b) => a.table.localeCompare(b.table));

if (declared.length === 0) {
  console.error(
    "no drizzle tables found — the schema import shape changed, so this script\nis comparing nothing. Fix the filter above before trusting a green run.",
  );
  process.exitCode = 1;
  await close();
  process.exit(1);
}

const actual = await sql<{ table_name: string; column_name: string }>(
  `SELECT table_name, column_name
     FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name`,
);

// Group the database side into the same shape as the declared side.
const live = new Map<string, Set<string>>();
for (const row of actual) {
  if (!live.has(row.table_name)) live.set(row.table_name, new Set());
  live.get(row.table_name)!.add(row.column_name);
}

/*
  Only tables schema.ts claims are in scope for "declared but absent". The
  reverse table would also be reported, because an unmigrated table is exactly
  the silent-no-op case apply-migration.ts exists to prevent.
*/
let problems = 0;

console.log(`branch: ${branch()}`);
console.log(`drizzle tables: ${declared.length}   database tables: ${live.size}\n`);

for (const { table, columns } of declared) {
  const dbColumns = live.get(table);

  if (!dbColumns) {
    console.log(`  MISSING TABLE  ${table} — declared in schema.ts, not in the database`);
    problems++;
    continue;
  }

  const missingFromSchema = [...dbColumns].filter((c) => !columns.has(c)).sort();
  const missingFromDatabase = [...columns].filter((c) => !dbColumns.has(c)).sort();

  for (const column of missingFromSchema) {
    console.log(`  NOT IN SCHEMA   ${table}.${column} — exists in the database only`);
    problems++;
  }
  for (const column of missingFromDatabase) {
    console.log(`  NOT IN DATABASE ${table}.${column} — declared in schema.ts only`);
    problems++;
  }

  if (missingFromSchema.length === 0 && missingFromDatabase.length === 0) {
    console.log(`  ok  ${table}  (${columns.size} columns)`);
  }
}

for (const table of [...live.keys()].sort()) {
  if (!declared.some((d) => d.table === table)) {
    console.log(`  UNDECLARED      ${table} — table in the database, absent from schema.ts`);
    problems++;
  }
}

console.log(
  problems === 0
    ? "\nschema and database agree"
    : `\n${problems} difference(s) between schema.ts and the database`,
);
if (problems > 0) process.exitCode = 1;

await close();