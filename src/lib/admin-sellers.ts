import { client, query } from "@/db";
import { validateSuspensionReason } from "@/lib/admin-moderation-rules";

/*
  Seller administration: the I/O half.

  The rules live in admin-moderation-rules.ts with no database import, so any
  client component can use them without dragging pg into the browser bundle.

  Suspension is a single column, and that is the whole design. A suspended
  seller's products are hidden by the join condition in PRODUCT_SELECT and the
  repeated one in basePredicates — nothing about the products themselves is
  touched — so reinstating the seller brings the entire catalogue back exactly
  as it was, with no inverse operation to get wrong.

  Two deliberate omissions:

    * No phone number. `sellers.phone` is rendered nowhere in the console, so
      the rule stays blunt — no phone number on any admin screen, audited or
      not — and nobody has to reason about whether a seller's number counts as
      the same class of data as a buyer's.
    * No delete. `order_items.seller_id` and `orders.seller_id` are both
      `onDelete: restrict`, so a seller with any order history cannot be
      removed. Suspension is the removal path.
*/

export type AdminSellerStatus = "active" | "suspended";

export const SELLER_STATUS_LABEL: Record<AdminSellerStatus, string> = {
  active: "Active",
  suspended: "Suspended",
};

export type AdminSellerRow = {
  id: string;
  slug: string;
  name: string;
  location: string;
  joinedYear: number;
  rating: number;
  ratingCount: number;
  onTimeRate: number;
  isVerified: boolean;
  isOfficialStore: boolean;
  status: AdminSellerStatus;
  suspendedAt: string | null;
  suspensionReason: string | null;
  productCount: number;
};

export type SellerFilter = {
  status?: "all" | AdminSellerStatus;
  verified?: "all" | "yes" | "no";
  q?: string;
};

/* ------------------------------------------------------------------ reads --- */

export async function getSellerStatusCounts(): Promise<
  Array<{ status: AdminSellerStatus; count: number }>
> {
  const rows = await query<{ status: string; count: number }>(
    `SELECT status, count(*)::int AS count
       FROM sellers
      GROUP BY status`,
  );
  const counts = new Map(rows.map((r) => [r.status, Number(r.count)]));

  // Both statuses appear even when one is empty. A filter bar that drops a tab
  // makes an empty result look like something went wrong.
  return (["active", "suspended"] as const).map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

export async function listAdminSellers(
  filter: SellerFilter = {},
  limit = 100,
): Promise<AdminSellerRow[]> {
  const { status = "all", verified = "all", q = "" } = filter;

  const predicates: string[] = [];
  const params: unknown[] = [];

  if (status === "active" || status === "suspended") {
    params.push(status);
    predicates.push(`s.status = $${params.length}`);
  }
  if (verified === "yes" || verified === "no") {
    params.push(verified === "yes");
    predicates.push(`s.is_verified = $${params.length}`);
  }
  if (q.trim()) {
    // Escaped: a moderator searching for "100%" should not match everything.
    params.push(`%${q.trim().replace(/([\\%_])/g, "\\$1")}%`);
    predicates.push(`(s.name ILIKE $${params.length} OR s.slug ILIKE $${params.length})`);
  }

  params.push(limit);

  const rows = await query<{
    id: string;
    slug: string;
    name: string;
    location: string;
    joined_year: number;
    rating: string | null;
    rating_count: number;
    on_time_rate: string | null;
    is_verified: boolean;
    is_official_store: boolean;
    status: string;
    suspended_at: Date | null;
    suspension_reason: string | null;
    product_count: number;
  }>(
    `SELECT s.id, s.slug, s.name, s.location, s.joined_year, s.rating,
            s.rating_count, s.on_time_rate, s.is_verified, s.is_official_store,
            s.status, s.suspended_at, s.suspension_reason,
            (SELECT count(*)::int FROM products p WHERE p.seller_id = s.id) AS product_count
       FROM sellers s
      ${predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : ""}
      ORDER BY s.name
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    location: r.location,
    joinedYear: r.joined_year,
    rating: Number(r.rating ?? 0),
    ratingCount: Number(r.rating_count),
    onTimeRate: Number(r.on_time_rate ?? 0),
    isVerified: r.is_verified,
    isOfficialStore: r.is_official_store,
    status: r.status as AdminSellerStatus,
    suspendedAt: r.suspended_at ? new Date(r.suspended_at).toISOString() : null,
    suspensionReason: r.suspension_reason,
    productCount: Number(r.product_count),
  }));
}

/* ----------------------------------------------------------------- writes --- */

export type SellerWriteResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Verified is a claim about the past — "we have checked them". It is a
 * different fact from active, which is a decision about the present, and the
 * schema keeps them in separate columns for that reason. Setting one never
 * moves the other: suspending a verified seller does not quietly un-verify
 * them, and reinstating them does not hand back a badge nobody earned twice.
 */
export async function setSellerVerified({
  sellerId,
  verified,
  actor,
}: {
  sellerId: string;
  verified: boolean;
  actor: string;
}): Promise<SellerWriteResult> {
  const conn = await client();
  try {
    await conn.query("BEGIN");

    const current = await conn.query<{ name: string; is_verified: boolean }>(
      `SELECT name, is_verified FROM sellers WHERE id = $1 FOR UPDATE`,
      [sellerId],
    );
    if (current.rows.length === 0) {
      await conn.query("ROLLBACK");
      return { ok: false, message: "That seller no longer exists." };
    }

    if (current.rows[0].is_verified === verified) {
      await conn.query("ROLLBACK");
      return {
        ok: false,
        message: verified
          ? `${current.rows[0].name} is already verified.`
          : `${current.rows[0].name} is not verified.`,
      };
    }

    await conn.query(`UPDATE sellers SET is_verified = $2 WHERE id = $1`, [
      sellerId,
      verified,
    ]);
    await conn.query("COMMIT");

    const { recordAdminAction } = await import("@/lib/admin-audit");
    await recordAdminAction({
      actor,
      action: verified ? "seller_verify" : "seller_unverify",
      target: current.rows[0].name,
      note: verified ? "Marked verified" : "Verification withdrawn",
    });

    return {
      ok: true,
      message: verified
        ? `${current.rows[0].name} is now verified.`
        : `${current.rows[0].name} is no longer verified.`,
    };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    console.error("suspendSeller failed", err);
    return { ok: false, message: "That could not be saved. Try again." };
  } finally {
    conn.release();
  }
}

export async function suspendSeller({
  sellerId,
  reason,
  actor,
}: {
  sellerId: string;
  reason: string;
  actor: string;
}): Promise<SellerWriteResult> {
  const checked = validateSuspensionReason(reason);
  if (!checked.ok) return { ok: false, message: checked.message };

  const conn = await client();
  try {
    await conn.query("BEGIN");

    const current = await conn.query<{ name: string; status: string }>(
      `SELECT name, status FROM sellers WHERE id = $1 FOR UPDATE`,
      [sellerId],
    );
    if (current.rows.length === 0) {
      await conn.query("ROLLBACK");
      return { ok: false, message: "That seller no longer exists." };
    }

    if (current.rows[0].status === "suspended") {
      await conn.query("ROLLBACK");
      return { ok: false, message: `${current.rows[0].name} is already suspended.` };
    }

    // Counted after the row lock, on its own: `FOR UPDATE` and an aggregate
    // subquery in the same statement is a restriction worth not leaning on.
    const counted = await conn.query<{ product_count: number }>(
      `SELECT count(*)::int AS product_count FROM products WHERE seller_id = $1`,
      [sellerId],
    );

    /*
      Only the seller row moves. The products stay `active` and stay where they
      are, because the catalogue filters on the seller — which is what makes
      this reversible in one step and leaves every product's own history
      untouched.

      The reason is written here rather than only in the audit row: the console
      has to be able to explain a suspension to whoever reads it next, and an
      audit log is a worse place to look than the row itself. It is never sent
      to a shopper — the queries that reach the storefront do not select it.
    */
    await conn.query(
      `UPDATE sellers
          SET status = 'suspended', suspended_at = now(), suspension_reason = $2
        WHERE id = $1`,
      [sellerId, checked.reason],
    );
    await conn.query("COMMIT");

    const products = counted.rows[0].product_count;
    const { recordAdminAction } = await import("@/lib/admin-audit");
    await recordAdminAction({
      actor,
      action: "seller_suspend",
      target: current.rows[0].name,
      note: checked.reason,
    });

    return {
      ok: true,
      message: `${current.rows[0].name} is suspended${
        products > 0
          ? `. Their ${products} product${products === 1 ? " is" : "s are"} hidden from the catalogue and cannot be checked out`
          : ""
      }. Their orders are untouched.`,
    };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    console.error("suspendSeller failed", err);
    return { ok: false, message: "That could not be saved. Try again." };
  } finally {
    conn.release();
  }
}

export async function unsuspendSeller({
  sellerId,
  actor,
}: {
  sellerId: string;
  actor: string;
}): Promise<SellerWriteResult> {
  const conn = await client();
  try {
    await conn.query("BEGIN");

    const current = await conn.query<{
      name: string;
      status: string;
      suspension_reason: string | null;
    }>(`SELECT name, status, suspension_reason FROM sellers WHERE id = $1 FOR UPDATE`, [
      sellerId,
    ]);
    if (current.rows.length === 0) {
      await conn.query("ROLLBACK");
      return { ok: false, message: "That seller no longer exists." };
    }
    if (current.rows[0].status === "active") {
      await conn.query("ROLLBACK");
      return { ok: false, message: `${current.rows[0].name} is not suspended.` };
    }

    // The reason goes with it. Once a seller is serving again, leaving the
    // accusation beside their name is the kind of thing that follows somebody
    // into the next moderator's shift.
    await conn.query(
      `UPDATE sellers
          SET status = 'active', suspended_at = NULL, suspension_reason = NULL
        WHERE id = $1`,
      [sellerId],
    );
    await conn.query("COMMIT");

    const { recordAdminAction } = await import("@/lib/admin-audit");
    await recordAdminAction({
      actor,
      action: "seller_unsuspend",
      target: current.rows[0].name,
      note: current.rows[0].suspension_reason
        ? `Reinstated; was suspended for: ${current.rows[0].suspension_reason}`
        : "Reinstated",
    });

    return { ok: true, message: `${current.rows[0].name} is active again.` };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    console.error("unsuspendSeller failed", err);
    return { ok: false, message: "That could not be saved. Try again." };
  } finally {
    conn.release();
  }
}
