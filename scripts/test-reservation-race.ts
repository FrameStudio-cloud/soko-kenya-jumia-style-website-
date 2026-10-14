import { sql, close } from "./db";

/*
  The race that matters.

  Two shoppers, one unit left. Both click "add to cart" at the same instant.
  The naive implementation — SELECT stock, check in JS, INSERT — lets both
  through, because both read stock=1 before either writes.

  The fix is a single atomic statement that both reads availability and takes
  the hold, so there is no gap between them:

    UPDATE products
       SET stock_reserved = stock_reserved + $qty
     WHERE id = $product
       AND stock - stock_reserved >= $qty
    RETURNING stock, stock_reserved

  Postgres takes a row lock for the UPDATE, so the second transaction blocks
  until the first commits, then re-evaluates the WHERE against the updated
  row. Under READ COMMITTED that re-evaluation is exactly what makes this
  correct: the loser sees the winner's reserved count and matches zero rows.

  This script proves it with real concurrent connections, not a description
  of why it should work. Run: npx tsx scripts/test-reservation-race.ts
*/

import { Pool } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const RESERVATION_MINUTES = 30;

/*
  Mirrors the statement in src/lib/cart.ts. Kept as SQL text here rather than
  imported so the test exercises the database behaviour independently of the
  app's query layer — a test that shares the implementation with the code
  cannot catch an error in that implementation.
*/
const RESERVE_SQL = `
  UPDATE products
     SET stock_reserved = stock_reserved + $2
   WHERE id = $1
     AND status = 'active'
     AND stock - stock_reserved >= $2
  RETURNING stock, stock_reserved
`;

async function main() {
  const setup = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
  const workers: Pool[] = [];

  // Fresh product with stock=1, so exactly one winner is possible.
  const [{ id: sellerId }] = await sql<{ id: string }>(
    `SELECT id FROM sellers LIMIT 1`,
  );
  const [{ id: categoryId }] = await sql<{ id: string }>(
    `SELECT id FROM categories LIMIT 1`,
  );

  // Every NOT NULL column that has no default must be supplied. An earlier
  // version omitted seller_id and category_id and failed on 23502, which
  // says nothing about the race being tested.
  const [{ id: productId }] = await sql<{ id: string }>(`
    INSERT INTO products
      (slug, title, price, stock, stock_reserved, status,
       seller_id, category_id, delivery_fee, rating, rating_count)
    VALUES ('tmp-race-product', 'Race Test', 1000, 1, 0, 'active',
            $1, $2, 0, 0, 0)
    RETURNING id
  `, [sellerId, categoryId]);

  console.log("=== two buyers race for the last unit ===");
  console.log("  product stock = 1, both request 1\n");

  const attempt = async (label: string) => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    workers.push(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(RESERVE_SQL, [productId, 1]);
      const won = res.rowCount === 1;

      if (won) {
        /*
          Only the winner records a hold. A real cart is created here rather
          than passing a bare gen_random_uuid(), because cart_id carries a
          foreign key — a synthetic uuid fails 23503 and gets reported as a
          loss, which is how the first run of this test showed two winners
          that had in fact both reserved.
        */
        const cart = await client.query<{ id: string }>(
          `INSERT INTO carts (session_id) VALUES ($1) RETURNING id`,
          [`race-${label}`],
        );
        await client.query(
          `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
           VALUES ($1, $2, 1, now() + ($3 || ' minutes')::interval)`,
          [productId, cart.rows[0].id, String(RESERVATION_MINUTES)],
        );
      }
      await client.query("COMMIT");
      return { label, won };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      return { label, won: false, error: String((err as Error).message) };
    } finally {
      client.release();
    }
  };

  // Fired together, so the transactions genuinely overlap.
  const results = await Promise.all([attempt("buyer A"), attempt("buyer B")]);

  for (const r of results) {
    console.log(`  ${r.label}: ${r.won ? "RESERVED" : "rejected (sold out)"}`);
    if (r.error) console.log(`    error: ${r.error}`);
  }

  const [{ stock, stock_reserved }] = await sql<{
    stock: number;
    stock_reserved: number;
  }>(`SELECT stock, stock_reserved FROM products WHERE id = $1`, [productId]);

  const holds = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM stock_reservations WHERE product_id = $1 AND released_at IS NULL`,
    [productId],
  );

  console.log(`\n  final stock          = ${stock}`);
  console.log(`  final stock_reserved = ${stock_reserved}`);
  console.log(`  live reservation rows = ${holds[0].n}`);

  const winners = results.filter((r) => r.won).length;
  console.log(`\n  winners = ${winners}`);

  let failed = false;
  if (winners !== 1) {
    console.log("  FAIL expected exactly one winner");
    failed = true;
  } else {
    console.log("  pass exactly one buyer got the last unit");
  }

  if (Number(stock_reserved) !== 1) {
    console.log(`  FAIL stock_reserved = ${stock_reserved}, expected 1`);
    failed = true;
  } else {
    console.log("  pass stock_reserved is 1, not 2 (no oversell)");
  }

  if (Number(holds[0].n) !== 1) {
    console.log(`  FAIL ${holds[0].n} reservation rows, expected 1`);
    failed = true;
  } else {
    console.log("  pass exactly one reservation row exists");
  }

  console.log("\n=== availability check ===");
  const avail = await sql<{ available: number }>(
    `SELECT stock - COALESCE(
       (SELECT sum(quantity) FROM stock_reservations
         WHERE product_id = $1 AND released_at IS NULL AND expires_at > now()), 0
     )::int AS available
     FROM products WHERE id = $1`,
    [productId],
  );
  console.log(`  available to other shoppers = ${avail[0].available}`);
  if (avail[0].available !== 0) {
    console.log("  FAIL expected 0 available after the unit was taken");
    failed = true;
  } else {
    console.log("  pass availability is 0");
  }

  console.log("\n=== expiry releases the hold without a sweep job ===");
  await sql(
    `UPDATE stock_reservations SET expires_at = now() - interval '1 minute'
     WHERE product_id = $1`,
    [productId],
  );
  const afterExpiry = await sql<{ available: number }>(
    `SELECT stock - COALESCE(
       (SELECT sum(quantity) FROM stock_reservations
         WHERE product_id = $1 AND released_at IS NULL AND expires_at > now()), 0
     )::int AS available
     FROM products WHERE id = $1`,
    [productId],
  );
  console.log(`  available after expiry = ${afterExpiry[0].available}`);
  if (afterExpiry[0].available !== 1) {
    console.log("  FAIL a lapsed reservation must not hold stock");
    failed = true;
  } else {
    console.log("  pass lapsed hold stops counting with no sweep running");
  }

  console.log("\n=== cleanup ===");
  await sql(`DELETE FROM stock_reservations WHERE product_id = $1`, [productId]);
  // Carts cascade their reservations, but delete them explicitly so the
  // partial unique index on session_id is left clean for the next run.
  await sql(`DELETE FROM carts WHERE session_id LIKE 'race-%'`);
  await sql(`DELETE FROM products WHERE id = $1`, [productId]);
  console.log(`  seller ${sellerId} left untouched`);

  for (const w of workers) await w.end();
  await setup.end();

  console.log(failed ? "\nRESULT: FAILURES ABOVE" : "\nRESULT: race is correctly handled");
  if (failed) process.exitCode = 1;
}

await main();
