/*
  Create a few genuine demo orders by calling the REAL placeOrder().

  These are for the portfolio screenshots: the admin order list is empty
  otherwise, and an empty back office is not worth showing. Every order is
  produced by the production checkout path, so the rows, the lines, the totals
  and the status history are exactly what a shopper would have created.
*/
import { close, sql } from "./db";

const { placeOrder } = await import("@/lib/checkout");
const { transitionOrder } = await import("@/lib/admin-orders");

/*
  Pre-clean. A previous run may have died before converting its cart, and
  carts.session_id is unique among active carts, so the insert below would be
  refused. Deleting the cart cascades to its reservations WITHOUT releasing
  products.stock_reserved, so the counter is recomputed from the rows at the
  end of this script rather than decremented by hand.
*/
const stale = await sql<{ id: string }>(
  `SELECT id FROM carts WHERE session_id LIKE 'demo-%'`,
);
for (const c of stale) await sql(`DELETE FROM carts WHERE id = $1`, [c.id]);
if (stale.length) console.log(`pre-clean: removed ${stale.length} stale demo cart(s)`);

type Line = { slug: string; qty: number };

const ORDERS: Array<{
  session: string;
  recipient: string;
  phone: string;
  county: string;
  town: string;
  street: string;
  lines: Line[];
  drive: string[];
}> = [
  {
    session: "demo-1",
    recipient: "Amina Wanjiru",
    phone: "0712345678",
    county: "Nairobi",
    town: "Westlands",
    street: "Ring Road Parklands, House No. 14",
    lines: [
      { slug: "sony-wh-1000xm5-headphones", qty: 1 },
      { slug: "samsung-galaxy-tab-a9-64gb", qty: 1 },
    ],
    drive: [],
  },
  {
    session: "demo-2",
    recipient: "Brian Otieno",
    phone: "0722987654",
    county: "Mombasa",
    town: "Nyali",
    street: "Tawakalight Centre, Moi Avenue",
    lines: [
      { slug: "kenya-tea-250g", qty: 2 },
      { slug: "milk-1l-packet", qty: 4 },
      { slug: "sugar-1kg", qty: 2 },
    ],
    drive: ["confirmed", "dispatched"],
  },
  {
    session: "demo-3",
    recipient: "Grace Njeri",
    phone: "0711443322",
    county: "Kisumu",
    town: "Kisumu Town",
    street: "Oginga Odinga Road, Megaflex Plaza",
    lines: [
      { slug: "nivea-body-lotion-400ml", qty: 1 },
      { slug: "logitech-mouse-b07", qty: 1 },
    ],
    drive: ["confirmed", "dispatched", "delivered"],
  },
];

for (const o of ORDERS) {
  process.env.CART_SESSION_OVERRIDE = o.session;

  const cartRows = await sql<{ id: string }>(
    `INSERT INTO carts (session_id) VALUES ($1) RETURNING id`,
    [o.session],
  );
  const cartId = cartRows[0].id;

  for (const line of o.lines) {
    const p = await sql<{ id: string; price: string }>(
      `SELECT id, price FROM products WHERE slug = $1 AND status = 'active'`,
      [line.slug],
    );
    if (!p.length) {
      console.log(`  skip ${line.slug}: not found or not active`);
      continue;
    }
    await sql(
      `UPDATE products SET stock_reserved = stock_reserved + $2 WHERE id = $1`,
      [p[0].id, line.qty],
    );
    await sql(
      `INSERT INTO stock_reservations (product_id, cart_id, quantity, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      [p[0].id, cartId, line.qty],
    );
    await sql(
      `INSERT INTO cart_items (cart_id, product_id, quantity, added_price) VALUES ($1, $2, $3, $4)`,
      [cartId, p[0].id, line.qty, p[0].price],
    );
  }

  const result = await placeOrder({
    recipientName: o.recipient,
    phone: o.phone,
    county: o.county,
    town: o.town,
    street: o.street,
    paymentMethod: "cod",
  });

  if (!result.ok) {
    console.log(`FAILED ${o.recipient}: ${result.message ?? JSON.stringify(result)}`);
    continue;
  }

  const references = result.references;
  console.log(`placed ${references.join(", ")} for ${o.recipient} (${o.county})`);

  for (const reference of references) {
    const rows = await sql<{ id: string; status: string }>(
      `SELECT id, status FROM orders WHERE reference = $1`,
      [reference],
    );
    if (!rows.length) continue;

    for (const to of o.drive) {
      const t = await transitionOrder({
        orderId: rows[0].id,
        toStatus: to,
        note: "Demo data for the portfolio screenshots",
        actor: "portfolio-seed",
      });
      console.log(`   ${reference} -> ${to}: ${t.ok ? "ok" : JSON.stringify(t)}`);
      if (t.ok) rows[0].status = to;
    }
  }
}

// Reconcile the counter against the rows, which are the source of truth.
await sql(
  `UPDATE products p SET stock_reserved = COALESCE((
      SELECT SUM(r.quantity) FROM stock_reservations r
       WHERE r.product_id = p.id AND r.expires_at > now()), 0)`,
);

const drift = await sql<{ n: number }>(
  `SELECT count(*)::int AS n FROM products p
    WHERE p.stock_reserved <> COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r
                     WHERE r.product_id = p.id AND r.expires_at > now()), 0)`,
);
console.log("counter drift:", drift[0].n);

const summary = await sql<{ status: string; n: number }>(
  `SELECT status, count(*)::int AS n FROM orders GROUP BY status ORDER BY status`,
);
console.log("orders:", JSON.stringify(summary));

await close();
