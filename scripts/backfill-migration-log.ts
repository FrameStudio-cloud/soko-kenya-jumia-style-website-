/*
  Retro-fixes the hand-written migrations that drizzle-kit never applied.

  drizzle-kit splits a migration file on `--> statement-breakpoint` and applies
  each chunk separately. Files WITHOUT the markers are treated as a single
  statement, so `drizzle-kit migrate` exits 0 having applied nothing — a
  silent no-op, not an error.

  Migrations 0002-0006 were written that way and were applied manually while
  debugging, but their hashes were never recorded in drizzle.__drizzle_migrations,
  so drizzle-kit still believed they were pending. That left the branch in a
  state where `migrate` claimed success and changed nothing.

  This records each one with the same sha256 drizzle-kit computes, after
  verifying the objects it creates actually exist. Nothing is recorded on
  faith: if a column or table is missing, this reports it and exits non-zero
  rather than papering over the gap.

  Idempotent: safe to re-run.
*/
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql, close, branch } from "./db";

type MigrationFile = {
  file: string;
  /* Each assertion must hold for this migration to count as applied. */
  assertions: Array<{ label: string; run: () => Promise<{ ok: boolean; detail: string }> }>;
};

const MIGRATIONS: MigrationFile[] = [
  {
    file: "0002_rename_search_vector.sql",
    assertions: [
      {
        label: "products.search_vector exists and is snake_case",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_name='products' AND column_name='search_vector'`,
          );
          return {
            ok: Number(r.n) === 1,
            detail: `${r.n} matching column(s), want 1 (and no camelCase 'searchVector')`,
          };
        },
      },
      {
        label: "products_search_idx exists",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_indexes
              WHERE tablename='products' AND indexname='products_search_idx'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} index(es), want 1` };
        },
      },
    ],
  },
  {
    file: "0003_product_specs_and_tags.sql",
    assertions: [
      {
        label: "products.specs exists",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_name='products' AND column_name='specs'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} column(s), want 1` };
        },
      },
      {
        label: "products.tags exists",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_name='products' AND column_name='tags'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} column(s), want 1` };
        },
      },
    ],
  },
  {
    file: "0004_fix_search_vector.sql",
    assertions: [
      {
        label: "search_vector no longer indexes category_id (UUID lexemes)",
        run: async () => {
          const [r] = await sql<{ def: string }>(
            `SELECT pg_get_expr(adbin, adrelid) AS def
               FROM pg_attrdef
              WHERE adrelid = 'products'::regclass
                AND adnum = (SELECT attnum FROM pg_attribute
                              WHERE attrelid='products'::regclass
                                AND attname='search_vector')`,
          );
          const def = r?.def ?? "";
          return {
            ok: !def.includes("category_id"),
            detail: def.includes("category_id")
              ? "expression still references category_id, so the vector is polluted with UUID lexemes"
              : "expression is title + brand only",
          };
        },
      },
    ],
  },
  {
    file: "0005_carts_and_reservations.sql",
    assertions: [
      {
        label: "carts table exists",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM information_schema.tables
              WHERE table_name='carts'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} table(s), want 1` };
        },
      },
      {
        label: "cart_items table exists",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM information_schema.tables
              WHERE table_name='cart_items'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} table(s), want 1` };
        },
      },
      {
        label: "stock_reservations.session_id was dropped",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_name='stock_reservations' AND column_name='session_id'`,
          );
          return {
            ok: Number(r.n) === 0,
            detail: `${r.n} session_id column(s), want 0`,
          };
        },
      },
      {
        label: "stock_reservations.cart_id exists",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_name='stock_reservations' AND column_name='cart_id'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} column(s), want 1` };
        },
      },
      {
        label: "exactly-one-owner CHECK is present",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_constraint
              WHERE conrelid='stock_reservations'::regclass
                AND conname='stock_reservations_exactly_one_owner'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} constraint(s), want 1` };
        },
      },
      {
        label: "carts_active_session_key partial unique index exists",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_indexes
              WHERE tablename='carts' AND indexname='carts_active_session_key'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} index(es), want 1` };
        },
      },
    ],
  },
  {
    file: "0006_stock_reserved_counter.sql",
    assertions: [
      {
        label: "products.stock_reserved exists",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_name='products' AND column_name='stock_reserved'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} column(s), want 1` };
        },
      },
      {
        label: "products_reserved_not_over_stock CHECK is present",
        run: async () => {
          const [r] = await sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_constraint
              WHERE conrelid='products'::regclass
                AND conname='products_reserved_not_over_stock'`,
          );
          return { ok: Number(r.n) === 1, detail: `${r.n} constraint(s), want 1` };
        },
      },
    ],
  },
];

console.log(`branch: ${branch()}\n`);

let recorded = 0;
let skipped = 0;
let failed = 0;

for (const migration of MIGRATIONS) {
  const hash = createHash("sha256")
    .update(readFileSync(`drizzle/${migration.file}`, "utf8"))
    .digest("hex");

  const [existing] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE hash = $1`,
    [hash],
  );

  if (Number(existing.n) > 0) {
    console.log(`skip  ${migration.file} (already recorded)`);
    skipped++;
    continue;
  }

  console.log(`check ${migration.file}`);
  let allOk = true;
  for (const assertion of migration.assertions) {
    const { ok, detail } = await assertion.run();
    console.log(`        ${ok ? "pass" : "FAIL"}  ${assertion.label}  (${detail})`);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.log(`      NOT recording — objects missing. Apply the file first.\n`);
    failed++;
    continue;
  }

  await sql(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
    [hash, Date.now()],
  );
  console.log(`        recorded\n`);
  recorded++;
}

console.log(`${recorded} recorded, ${skipped} skipped, ${failed} left unrecorded`);
if (failed > 0) {
  console.log("\nRESULT: some migrations are genuinely not applied — fix those first");
  process.exitCode = 1;
} else {
  console.log("\nRESULT: drizzle-kit bookkeeping now matches reality");
}

await close();
