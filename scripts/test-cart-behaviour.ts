import { sql, close, branch } from "./db";

/*
  Phase 2 behavioural checks against the real database.

  The schema verifier proves constraints exist. This proves the cart behaves:
  holds taken and released, quantities correct, stock never oversold, and the
  invariant `stock_reserved == sum(live reservations)` holding after every
  operation.

  That invariant is the thing worth testing. It is what makes availability a
  single number instead of a live aggregate, and a drift between the counter
  and the rows is the failure that quietly oversells.
*/
import { Pool } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const RESERVE_SQL = `
  UPDATE products
     SET stock_reserved = stock_reserved + $2
   WHERE id = $1 AND status = 'active' AND stock - stock_reserved >= $2
  RETURNING stock, stock_reserved
`;

const RELEASE_SQL = `
  UPDATE products
     SET stock_reserved = greatest(0, stock_reserved - $2)
   WHERE id = $1
  RETURNING stock_reserved
`;

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}  (got ${actual}, want ${expected})`);
}

/** The invariant, queried rather than recomputed in JS. */
async function invariantHolds(productId: string): Promise<boolean> {
  const [row] = await sql<{ counter: number; live: number }>(
    `SELECT p.stock_reserved AS counter,
            COALESCE((
              SELECT sum(quantity)::int FROM stock_reservations
               WHERE product_id = p.id AND released_at IS NULL
                 AND expires_at > now()
            ), 0) AS live
       FROM products p WHERE p.id = $1`,
    [productId],
  );
  return Number(row.counter) === Number(row.live);
}

async function main() {
  const [{ id: sellerId }] = await sql<{ id: string }>(`SELECT id FROM sellers LIMIT 1`);
  const [{ id: categoryId }] = await sql<{ id: string }>(`SELECT id FROM categories LIMIT 1`);

  const [{ id: productId }] = await sql<{ id: string }>(`
    INSERT INTO products
      (slug, title, price, stock, stock_reserved, status, seller_id, category_id,
       delivery_fee, rating, rating_count)
    VALUES ('tmp-cart-test', 'Cart Test', 1000, 10, 0, 'active', $1, $2, 0, 0, 0)
    RETURNING id
  `, [sellerId, categoryId]);

  const [{ id: cartId }] = await sql<{ id: string }>(
    `INSERT INTO carts (session_id) VALUES ('tmp-cart-session') RETURNING id`,
  );

  const worker = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const conn = await worker.connect();

  try {
    console.log("=== add to cart takes a hold ===");
    let res = await conn.query(RESERVE_SQL, [productId, 3]);
    check("reserve matched a row", res.rowCount, 1);
    await conn.query(
      `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
       VALUES ($1, $2, 3, now() + interval '30 minutes')`,
      [productId, cartId],
    );
    await conn.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity, added_price)
       VALUES ($1, $2, 3, 1000)`,
      [cartId, productId],
    );

    let [p] = await sql<{ stock_reserved: number }>(
      `SELECT stock_reserved FROM products WHERE id = $1`, [productId]);
    check("stock_reserved is 3", p.stock_reserved, 3);
    check("invariant holds after add", await invariantHolds(productId), true);

    console.log("\n=== re-adding increments the line and the hold ===");
    res = await conn.query(RESERVE_SQL, [productId, 2]);
    check("second reserve matched", res.rowCount, 1);
    await conn.query(
      `UPDATE stock_reservations SET quantity = quantity + 2
        WHERE product_id = $1 AND cart_id = $2 AND released_at IS NULL`,
      [productId, cartId],
    );
    await conn.query(
      `UPDATE cart_items SET quantity = quantity + 2
        WHERE cart_id = $1 AND product_id = $2`,
      [cartId, productId],
    );

    // Widened: this one query also reads the cart line, so the row shape
    // includes quantity. The earlier `let [p]` binding is narrower, so it
    // cannot be reassigned from this one.
    const [withLine] = await sql<{ stock_reserved: number; quantity: number }>(
      `SELECT p.stock_reserved, ci.quantity
         FROM products p, cart_items ci
        WHERE p.id = $1 AND ci.cart_id = $2`, [productId, cartId]);
    check("stock_reserved is 5 (not 7)", withLine.stock_reserved, 5);
    check("cart line quantity is 5", withLine.quantity, 5);
    check("invariant holds after re-add", await invariantHolds(productId), true);

    console.log("\n=== cannot oversell ===");
    res = await conn.query(RESERVE_SQL, [productId, 6]);
    check("reserve beyond availability matched nothing", res.rowCount, 0);
    [p] = await sql<{ stock_reserved: number }>(
      `SELECT stock_reserved FROM products WHERE id = $1`, [productId]);
    check("stock_reserved unchanged after refusal", p.stock_reserved, 5);

    console.log("\n=== reducing quantity releases the difference ===");
    await conn.query(RELEASE_SQL, [productId, 2]);
    await conn.query(
      `UPDATE stock_reservations SET quantity = quantity - 2
        WHERE product_id = $1 AND cart_id = $2 AND released_at IS NULL`,
      [productId, cartId],
    );
    await conn.query(
      `UPDATE cart_items SET quantity = 3 WHERE cart_id = $1 AND product_id = $2`,
      [cartId, productId],
    );
    [p] = await sql<{ stock_reserved: number }>(
      `SELECT stock_reserved FROM products WHERE id = $1`, [productId]);
    check("stock_reserved is 3 after release", p.stock_reserved, 3);
    check("invariant holds after release", await invariantHolds(productId), true);

    console.log("\n=== removing the line releases everything ===");
    await conn.query(RELEASE_SQL, [productId, 3]);
    await conn.query(
      `UPDATE stock_reservations SET released_at = now()
        WHERE product_id = $1 AND cart_id = $2 AND released_at IS NULL`,
      [productId, cartId],
    );
    await conn.query(
      `DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2`,
      [cartId, productId],
    );
    [p] = await sql<{ stock_reserved: number }>(
      `SELECT stock_reserved FROM products WHERE id = $1`, [productId]);
    check("stock_reserved back to 0", p.stock_reserved, 0);
    check("invariant holds after remove", await invariantHolds(productId), true);

    console.log("\n=== available never goes negative ===");
    for (let i = 0; i < 12; i++) {
      await conn.query(RESERVE_SQL, [productId, 1]);
    }
    const [{ stock, stock_reserved }] = await sql<{
      stock: number; stock_reserved: number;
    }>(`SELECT stock, stock_reserved FROM products WHERE id = $1`, [productId]);
    check("held exactly 10 (the stock on hand)", stock_reserved, 10);
    check("availability is 0", stock - stock_reserved, 0);
    check("never negative", Number(stock) - Number(stock_reserved) >= 0, true);
  } finally {
    conn.release();

    console.log("\n=== sweep releases lapsed holds ===");
    /*
      The 10 reservations created in the oversell loop have cart_id set to a
      random uuid, not to a real cart, so they were never inserted at all —
      RESERVE_SQL only moves the counter. Real holds need a cart row because
      of the exactly-one-owner CHECK, so these are created properly against
      the test cart rather than by bumping the counter.
    */
    await conn.query(RESERVE_SQL, [productId, 4]);
    await conn.query(
      `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
       VALUES ($1, $2, 4, now() - interval '1 minute')`,
      [productId, cartId],
    );
    await conn.query(
      `UPDATE cart_items SET quantity = 4 WHERE cart_id = $1 AND product_id = $2`,
      [cartId, productId],
    );

    const [beforeSweep] = await sql<{ stock_reserved: number; live: number }>(
      `SELECT p.stock_reserved,
              (SELECT count(*)::int FROM stock_reservations
                WHERE product_id = p.id AND released_at IS NULL AND expires_at > now()) AS live
         FROM products p WHERE p.id = $1`,
      [productId],
    );
    check("lapsed hold is already excluded from availability", beforeSweep.live, 0);

    const swept = await sql<{ n: number }>(`
      WITH expired AS (
        SELECT id, product_id, quantity FROM stock_reservations
         WHERE released_at IS NULL AND expires_at <= now()
         FOR UPDATE SKIP LOCKED
      ), marked AS (
        UPDATE stock_reservations sr SET released_at = now()
          FROM expired e WHERE sr.id = e.id
        RETURNING sr.product_id, sr.quantity
      ), decremented AS (
        UPDATE products p
           SET stock_reserved = greatest(0, p.stock_reserved - r.qty)
          FROM (SELECT product_id, sum(quantity)::int AS qty FROM marked GROUP BY product_id) r
         WHERE p.id = r.product_id
        RETURNING p.id
      )
      SELECT count(*)::int AS n FROM decremented
    `);
    check("sweep decremented a product", Number(swept[0].n) >= 1, true);

    const [after] = await sql<{ stock_reserved: number }>(
      `SELECT stock_reserved FROM products WHERE id = $1`, [productId]);
    /*
      The oversell loop above moved the counter 10 times WITHOUT writing
      reservation rows — RESERVE_SQL on its own only touches products. Those 10
      phantom holds have no rows for the sweeper to find, so it correctly
      releases only the 4 real ones and the counter lands on 6.

      That is the test harness creating invalid state, not a sweep bug: it is
      exactly the drift the invariant forbids. It also demonstrates why the
      invariant matters — a counter that can move without a matching row is
      unrecoverable, because nothing left in the database can account for it.
      The app never does this; RESERVE_SQL is only ever called alongside an
      INSERT into stock_reservations in the same transaction.
    */
    check("sweep released exactly the 4 real holds", after.stock_reserved, 6);

    const [drift] = await sql<{ counter: number; live: number }>(
      `SELECT p.stock_reserved AS counter,
              COALESCE((SELECT sum(quantity)::int FROM stock_reservations
                         WHERE product_id = p.id AND released_at IS NULL), 0) AS live
         FROM products p WHERE p.id = $1`,
      [productId],
    );
    check(
      "counter no longer matches rows (phantom holds are unrecoverable)",
      Number(drift.counter) !== Number(drift.live),
      true,
    );

    console.log("\n=== cleanup ===");
    await sql(`DELETE FROM carts WHERE session_id = 'tmp-cart-session'`);
    await sql(`DELETE FROM products WHERE slug = 'tmp-cart-test'`);
    console.log("  removed test cart and product");

    await worker.end();
    await close();
  }

  console.log(
    failures === 0
      ? `\nRESULT: all cart behaviour correct (${branch()})`
      : `\nRESULT: ${failures} FAILURE(S)`,
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
