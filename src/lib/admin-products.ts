import { client, query } from "@/db";
import {
  PRODUCT_STATUSES,
  validateProductEdit,
  type ProductFormValues,
  type ProductStatus,
} from "@/lib/admin-product-rules";

/*
  Catalogue administration: the I/O half.

  The rules — status meanings, field validation — live in
  admin-product-rules.ts with no database import, so ProductEditForm (a client
  component) can use them without dragging pg into the browser bundle.

  No deletes. `order_items.product_id` and `products.seller_id` are both
  `onDelete: restrict`, so once a product has been ordered a hard DELETE fails
  outright — the schema already forbids the destructive option. Status
  `archived` is the removal path, and it is a soft one: the row, its images and
  its order history all survive.

  Archiving needs no new query work. Every public read in src/lib/queries.ts
  already filters `p.status = 'active'`, so setting archived unpublishes
  immediately.
*/

export { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL, PRODUCT_STATUS_EFFECT } from "@/lib/admin-product-rules";
export type { ProductStatus } from "@/lib/admin-product-rules";

/* ------------------------------------------------------------------ reads --- */

export type AdminProductRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  stockReserved: number;
  status: ProductStatus;
  brand: string | null;
  deliveryFee: number;
  deliveryEstimateDays: number | null;
  sellerName: string;
  sellerId: string;
  categoryName: string;
  categoryId: string;
  imageKey: string | null;
  updatedAt: string;
};

export async function getProductStatusCounts(): Promise<
  Array<{ status: ProductStatus; count: number }>
> {
  const rows = await query<{ status: string; count: number }>(
    `SELECT status, count(*)::int AS count
       FROM products
      GROUP BY status`,
  );
  const counts = new Map(rows.map((r) => [r.status, Number(r.count)]));
  // Every status appears, including one with no products — a filter bar that
  // silently loses a tab makes an empty result look like a bug.
  return PRODUCT_STATUSES.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

export type ProductFilter = {
  status?: ProductStatus;
  q?: string;
  sellerId?: string;
  page?: number;
  perPage?: number;
};

export async function listAdminProducts({
  status,
  q,
  sellerId,
  page = 1,
  perPage = 25,
}: ProductFilter = {}): Promise<{ rows: AdminProductRow[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * perPage;
  const term = q?.trim() ? `%${q.trim().replace(/[%_\\]/g, "\\$&")}%` : "";

  /*
    Parameters, never string interpolation. The LIKE pattern is escaped too:
    a search for "100%" must not become a wildcard that quietly returns the
    whole catalogue.
  */
  const rows = await query<AdminProductRow>(
    `SELECT p.id,
            p.slug,
            p.title,
            p.description,
            p.price::float8 AS "price",
            p.compare_at_price::float8 AS "compareAtPrice",
            p.stock,
            p.stock_reserved AS "stockReserved",
            p.status,
            p.brand,
            p.delivery_fee::float8 AS "deliveryFee",
            p.delivery_estimate_days AS "deliveryEstimateDays",
            s.name AS "sellerName",
            p.seller_id AS "sellerId",
            c.name AS "categoryName",
            p.category_id AS "categoryId",
            (SELECT object_key FROM product_images pi
              WHERE pi.product_id = p.id ORDER BY pi.position LIMIT 1) AS "imageKey",
            p.updated_at AS "updatedAt"
       FROM products p
       JOIN sellers s ON s.id = p.seller_id
       JOIN categories c ON c.id = p.category_id
      WHERE ($1::text = '' OR p.status = $1)
        AND ($2::uuid IS NULL OR p.seller_id = $2)
        AND ($3::text = '' OR p.title ILIKE $3
                               OR p.brand ILIKE $3
                               OR p.slug ILIKE $3)
      ORDER BY p.updated_at DESC
      LIMIT $4 OFFSET $5`,
    [status ?? "", sellerId || null, term, perPage, offset],
  );

  const [totals] = await query<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM products p
      WHERE ($1::text = '' OR p.status = $1)
        AND ($2::uuid IS NULL OR p.seller_id = $2)
        AND ($3::text = '' OR p.title ILIKE $3
                               OR p.brand ILIKE $3
                               OR p.slug ILIKE $3)`,
    [status ?? "", sellerId || null, term],
  );

  return { rows, total: Number(totals.total) };
}

export type AdminChoices = {
  categories: Array<{ id: string; name: string }>;
  sellers: Array<{ id: string; name: string; status: string }>;
};

export async function getAdminChoices(): Promise<AdminChoices> {
  const [categories, sellers] = await Promise.all([
    query<{ id: string; name: string }>(
      `SELECT id, name FROM categories ORDER BY name`,
    ),
    query<{ id: string; name: string; status: string }>(
      `SELECT id, name, status FROM sellers ORDER BY name`,
    ),
  ]);
  return { categories, sellers };
}

export async function getAdminProductDetail(
  id: string,
): Promise<AdminProductRow | null> {
  const rows = await query<AdminProductRow>(
    `SELECT p.id,
            p.slug,
            p.title,
            p.description,
            p.price::float8 AS "price",
            p.compare_at_price::float8 AS "compareAtPrice",
            p.stock,
            p.stock_reserved AS "stockReserved",
            p.status,
            p.brand,
            p.delivery_fee::float8 AS "deliveryFee",
            p.delivery_estimate_days AS "deliveryEstimateDays",
            s.name AS "sellerName",
            p.seller_id AS "sellerId",
            c.name AS "categoryName",
            p.category_id AS "categoryId",
            (SELECT object_key FROM product_images pi
              WHERE pi.product_id = p.id ORDER BY pi.position LIMIT 1) AS "imageKey",
            p.updated_at AS "updatedAt"
       FROM products p
       JOIN sellers s ON s.id = p.seller_id
       JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/* ------------------------------------------------------------- mutations --- */

export type ProductUpdateResult =
  | { ok: true; message: string; statusChanged: boolean }
  | {
      ok: false;
      /** Per-field messages, when validation failed. */
      errors?: Record<string, string>;
      /** A single message, when the database refused the write. */
      message: string;
    };

/*
  Map a Postgres constraint violation to a sentence.

  The CHECK constraints already say exactly what went wrong — the problem is
  that they say it in SQLSTATE and constraint names. An operator who tries to
  set compare-at equal to price gets "23514 products_compare_at_greater", which
  is true and useless.

  Constraint names are matched rather than SQLSTATE alone because 23514 covers
  every CHECK in the schema, and "products_price_positive failed" needs a
  different sentence from "products_reserved_not_over_stock failed".
*/
function constraintMessage(constraint: string | undefined): string {
  switch (constraint) {
    case "products_price_positive":
      return "The price has to be above zero.";
    case "products_compare_at_greater":
      return "The old price must be higher than the price you are charging.";
    case "products_stock_nonneg":
      return "Stock cannot be negative.";
    case "products_stock_reserved_nonneg":
      return "Stock is out of sync with its holds — this needs a look before you edit it.";
    case "products_reserved_not_over_stock":
      return "Stock cannot be dropped below the units currently held in live carts.";
    case "products_slug_key":
      return "That slug is already used by another product.";
    case "products_seller_id_fkey":
      return "That seller no longer exists.";
    case "products_category_id_fkey":
      return "That category no longer exists.";
    default:
      return "The database refused this change.";
  }
}

/**
 * Edit a product.
 *
 * Validation happens INSIDE the transaction, after a `FOR UPDATE` lock, rather
 * than in the action before the write. That is not ceremony: the form was
 * rendered seconds ago, and `stock_reserved` is maintained by every other
 * shopper's cart. Validating against the rendered value and writing later is
 * exactly the gap the stock check exists to close — the number could have
 * changed while the operator was typing.
 *
 * actor is used only when the status changes, so publishing and unpublishing
 * are attributable in admin_audit_log. Ordinary edits (a price, a typo) are not
 * logged: they are visible on the row itself, and a log of every keystroke is
 * noise that gets ignored, which defeats the point of keeping one.
 */
export async function updateProduct({
  id,
  input,
  actor,
}: {
  id: string;
  input: ProductFormValues;
  actor: string;
}): Promise<ProductUpdateResult> {
  const conn = await client();

  try {
    await conn.query("BEGIN");

    const currentResult = await conn.query<{
      stock_reserved: number;
      status: string;
      slug: string;
    }>(
      `SELECT stock_reserved, status, slug
         FROM products WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const current = currentResult.rows[0];

    if (!current) {
      await conn.query("ROLLBACK");
      return { ok: false, message: "That product no longer exists." };
    }

    const validation = validateProductEdit(input, {
      stockReserved: Number(current.stock_reserved),
    });

    if (!validation.ok) {
      await conn.query("ROLLBACK");
      return { ok: false, errors: validation.errors, message: "Check the fields below." };
    }

    const v = validation.value;

    try {
      const result = await conn.query(
        `UPDATE products
            SET title = $2,
                slug = $3,
                description = $4,
                brand = $5,
                price = $6,
                compare_at_price = $7,
                stock = $8,
                delivery_fee = $9,
                delivery_estimate_days = $10,
                category_id = $11,
                seller_id = $12,
                status = $13,
                updated_at = now()
          WHERE id = $1
          RETURNING status, slug`,
        [
          id,
          v.title,
          v.slug,
          v.description,
          v.brand,
          v.price,
          v.compareAtPrice,
          v.stock,
          v.deliveryFee,
          v.deliveryEstimateDays,
          v.categoryId,
          v.sellerId,
          v.status,
        ],
      );

      const statusChanged = result.rows[0].status !== current.status;
      const slugChanged = result.rows[0].slug !== current.slug;

      await conn.query("COMMIT");

      // After the commit, deliberately: this is a record of what happened, and
      // it must not roll back with a later failure.
      if (statusChanged) {
        const { recordAdminAction } = await import("@/lib/admin-audit");
        await recordAdminAction({
          actor,
          action: "product_status_change",
          target: v.slug,
          note: `${current.status} → ${v.status}`,
        });
      }

      const notes: string[] = [];
      if (statusChanged) notes.push(`now ${v.status}`);
      if (slugChanged)
        notes.push(
          "public URL changed — any old links to this product will stop working",
        );

      return {
        ok: true,
        statusChanged,
        message: notes.length > 0 ? `Saved: ${notes.join("; ")}.` : "Saved.",
      };
    } catch (err) {
      await conn.query("ROLLBACK").catch(() => {});
      const e = err as { code?: string; constraint?: string };

      // 23505 unique_violation, 23503 foreign_key_violation, 23514
      // check_violation. Anything else is a genuine fault and should surface
      // as one rather than be laundered into "invalid input".
      if (e.code === "23505" || e.code === "23503" || e.code === "23514") {
        return { ok: false, message: constraintMessage(e.constraint) };
      }
      throw err;
    }
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
