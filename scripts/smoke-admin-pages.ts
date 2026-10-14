/*
  The admin HTTP guard.

  scripts/test-admin-orders.ts proves the token crypto and the order rules. It
  cannot prove the guard, because requireAdmin() reads cookies() and that throws
  outside a Next request scope. This file closes that gap for pages: it drives a
  real server over HTTP and asserts what an unauthenticated caller actually gets.

  The strongest assertion here is the last one — that a customer's phone number
  and street do not appear anywhere in the admin HTML. Masking that only shows
  up in the DOM if something forgets to mask.

  Usage: SMOKE_BASE_URL=http://localhost:3131 npx tsx scripts/smoke-admin-pages.ts
*/
import { config } from "dotenv";

config({ path: ".env.local" });

import { sql, close } from "./db";

const BASE = process.env.SMOKE_BASE_URL;
const SECRET = process.env.ADMIN_SESSION_SECRET;

if (!BASE) {
  console.error("SMOKE_BASE_URL is not set. Start the app and pass its URL.");
  process.exit(1);
}
if (!SECRET) {
  console.error(
    "ADMIN_SESSION_SECRET is not set. The admin console cannot be exercised\nwithout it — see docs/admin.md.",
  );
  process.exit(1);
}

// Bound after the guard so the type is `string` inside the closures below.
// TypeScript does not carry a narrowing into a function body.
const secret = SECRET;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}

const { signToken, tokenPayload } = await import("@/lib/admin");

/** A valid cookie minted here, with the same secret the server reads. */
function authCookie(): string {
  const payload = tokenPayload(Date.now() + 60_000);
  return `soko_admin=${payload}.${signToken(payload, secret)}`;
}

function get(path: string, cookie?: string) {
  return fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
}

const GUARDED = [
  "/admin",
  "/admin/orders",
  "/admin/orders/SKNOSUCHREFERENCE",
  "/admin/products",
  "/admin/products/00000000-0000-4000-8000-000000000000",
  "/admin/sellers",
  "/admin/reviews",
  "/admin/categories",
  "/admin/delivery-areas",
];

console.log("\nunauthenticated pages are refused");
for (const path of GUARDED) {
  const res = await get(path);
  const location = res.headers.get("location") ?? "";
  const redirected = res.status === 307 || res.status === 302;
  check(
    `${path} redirects to the login form`,
    redirected && location.includes("/admin/login"),
    `status=${res.status} location=${location}`,
  );
}

console.log("\nthe login page is reachable without a session");
{
  const res = await get("/admin/login");
  const body = await res.text();
  check("200", res.status === 200, `status=${res.status}`);
  check("asks for a password", body.includes("Admin password"));
  // It must not be the guarded layout — otherwise the guard would redirect it
  // to itself forever.
  check("not the admin nav", !body.includes("Sign out"));
}

console.log("\nforged and malformed cookies are refused");
for (const [label, cookie] of [
  ["unsigned", "soko_admin=abc.def"],
  ["wrong secret", `soko_admin=${tokenPayload(Date.now() + 60_000)}.${signToken("x", "attacker-secret")}`],
  ["garbage", "soko_admin=not-a-token"],
  ["expired", `soko_admin=${(() => { const p = tokenPayload(Date.now() - 1000); return `${p}.${signToken(p, secret)}`; })()}`],
] as Array<[string, string]>) {
  const res = await get("/admin", cookie);
  const location = res.headers.get("location") ?? "";
  check(
    `${label} cookie refused`,
    (res.status === 307 || res.status === 302) && location.includes("/admin/login"),
    `status=${res.status}`,
  );
}

console.log("\na valid session reaches the console");
const cookie = authCookie();
{
  const overview = await get("/admin", cookie);
  const body = await overview.text();
  check("overview 200", overview.status === 200, `status=${overview.status}`);
  check("overview renders", body.includes("Overview"));
  check("sign out offered", body.includes("Sign out"));

  const orders = await get("/admin/orders", cookie);
  check("orders list 200", orders.status === 200, `status=${orders.status}`);

  const products = await get("/admin/products", cookie);
  check("products list 200", products.status === 200, `status=${products.status}`);
  check(
    "products list renders its filter bar",
    (await products.text()).includes("Filter by status"),
  );

  const moderation: Array<[string, string, string]> = [
    ["/admin/sellers", "Sellers", "Suspend"],
    ["/admin/reviews", "Reviews", "Rating"],
    ["/admin/categories", "Categories", "Slug"],
    ["/admin/delivery-areas", "Delivery areas", "Nairobi"],
  ];
  for (const [path, heading, expected] of moderation) {
    const res = await get(path, cookie);
    const body = await res.text();
    check(`${path} 200`, res.status === 200, `status=${res.status}`);
    check(`${path} renders "${heading}"`, body.includes(heading));
    check(`${path} renders "${expected}"`, body.includes(expected));
  }

  const unknownProduct = await get(
    "/admin/products/00000000-0000-4000-8000-000000000000",
    cookie,
  );
  check("unknown product 404s", unknownProduct.status === 404, `status=${unknownProduct.status}`);

  // An unknown reference must 404 rather than render an empty detail page.
  const missing = await get("/admin/orders/SKNOSUCHREFERENCE", cookie);
  check("unknown reference 404s", missing.status === 404, `status=${missing.status}`);
}

console.log("\ncustomer data stays masked in the HTML");
{
  let [order] = await sql<{ reference: string; deliveryPhone: string | null; deliveryAddress: unknown }>(
    `SELECT reference, delivery_phone AS "deliveryPhone", delivery_address AS "deliveryAddress"
       FROM orders
      WHERE delivery_phone IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
  );

  // A branch with no orders would silently skip the most important assertion in
  // this file, so make one. Skipped-forever is how a privacy control quietly
  // stops being tested.
  let fixture = false;
  if (!order) {
    const [{ id: sellerId }] = await sql<{ id: string }>(`SELECT id FROM sellers LIMIT 1`);
    const [{ id: categoryId }] = await sql<{ id: string }>(`SELECT id FROM categories LIMIT 1`);
    const reference = `TMP-SMOKE-${Date.now()}`;

    const [{ id: productId }] = await sql<{ id: string }>(
      `INSERT INTO products (slug, title, price, stock, stock_reserved, status,
                             seller_id, category_id, delivery_fee, rating, rating_count)
       VALUES ($1, 'Smoke Fixture', 1000, 10, 0, 'active', $2, $3, 0, 0, 0)
       RETURNING id`,
      [`tmp-smoke-fixture-${Date.now()}`, sellerId, categoryId],
    );

    const [{ id: orderId }] = await sql<{ id: string }>(
      `INSERT INTO orders
         (reference, seller_id, status, subtotal, delivery_total, grand_total, county,
          payment_method, payment_status, delivery_address, delivery_phone)
       VALUES ($1, $2, 'confirmed', 1000, 0, 1000, 'Nairobi', 'cod', 'unpaid',
               '{"recipientName":"Amina Wanjiru","town":"Westlands","street":"Karen Blk 4, house 12"}',
               '0712345678')
       RETURNING id`,
      [reference, sellerId],
    );

    await sql(
      `INSERT INTO order_items (order_id, product_id, title_snapshot, unit_price, quantity, line_total)
       VALUES ($1, $2, 'Smoke Fixture', 1000, 1, 1000)`,
      [orderId, productId],
    );

    [order] = await sql(
      `SELECT reference, delivery_phone AS "deliveryPhone", delivery_address AS "deliveryAddress"
         FROM orders WHERE id = $1`,
      [orderId],
    );
    fixture = true;
  }

  try {
    const address = order.deliveryAddress as Record<string, unknown>;
    const res = await get(`/admin/orders/${order.reference}`, cookie);
    const body = await res.text();

    check(`detail 200 for ${order.reference}`, res.status === 200, `status=${res.status}`);

    if (order.deliveryPhone) {
      check(
        "phone number absent from the markup",
        !body.includes(order.deliveryPhone),
        `looked for ...${order.deliveryPhone.slice(-3)}`,
      );
    }
    if (typeof address?.recipientName === "string") {
      check("full recipient name absent", !body.includes(address.recipientName));
    }
    if (typeof address?.street === "string" && address.street) {
      check("street absent from the markup", !body.includes(address.street));
    }

    check("the masked form is present", body.includes("Reveal full details"));
    check("reveal is labelled as recorded", body.includes("Every reveal is recorded"));
  } finally {
    if (fixture && order) {
      await sql(`DELETE FROM orders WHERE reference = $1`, [order.reference]);
      await sql(`DELETE FROM products WHERE slug LIKE 'tmp-smoke-fixture-%'`);
    }
  }
}

console.log("\nno seller phone number reaches the HTML");
{
  /*
    Every other screen in this file masks a customer's details. The seller
    console masks nothing, because a review is public content and a seller's
    listing is theirs — except the phone number, which is rendered nowhere and
    deliberately not added here either. Asserting that keeps the omission
    intentional rather than an oversight somebody fixes by pasting the column
    into the template.
  */
  const slug = `tmp-smoke-seller-${Date.now()}`;
  const phone = "0799887766";

  const [{ id }] = await sql<{ id: string }>(
    `INSERT INTO sellers (slug, name, location, phone, joined_year, status)
          VALUES ($1, 'Tmp Smoke Seller', 'Nairobi', $2, 2026, 'active')
     RETURNING id`,
    [slug, phone],
  );

  try {
    const res = await get("/admin/sellers", cookie);
    const body = await res.text();
    check("sellers list 200", res.status === 200, `status=${res.status}`);
    check("the seller is listed", body.includes("Tmp Smoke Seller"));
    check("their phone number is absent", !body.includes(phone));
  } finally {
    await sql(`DELETE FROM sellers WHERE id = $1`, [id]);
  }
}

console.log(failures === 0 ? "\nadmin HTTP guard OK" : `\n${failures} check(s) failed`);
if (failures > 0) process.exitCode = 1;

await close();