import { client, query } from "@/db";
import {
  validateCategoryEdit,
  type CategoryFormValues,
} from "@/lib/admin-moderation-rules";

/*
  Category administration: the I/O half.

  Renaming and re-slugging only. There is no create and no delete, because a
  category owns every product filed under it — `products.category_id` is
  `onDelete: restrict`, so a category with products cannot be removed at all,
  and creating one is a content decision rather than a moderation one.

  The slug is the whole risk on this screen. It is the URL, and `/category/[slug]`
  is linked from the header rail, the footer and every product page, so changing
  it breaks links that are already in the wild — including ones search engines
  have indexed and ones somebody bookmarked. That is why the success message
  says so out loud instead of reporting a quiet "Saved.".
*/

export type AdminCategoryRow = {
  id: string;
  slug: string;
  name: string;
  /** Products a shopper can actually see, so it matches the public count. */
  productCount: number;
};

export async function listAdminCategories(): Promise<AdminCategoryRow[]> {
  const rows = await query<{
    id: string;
    slug: string;
    name: string;
    product_count: number;
  }>(
    `SELECT c.id, c.slug, c.name,
            (SELECT count(*)::int
               FROM products p
               JOIN sellers s ON s.id = p.seller_id
              WHERE p.category_id = c.id
                AND p.status = 'active'
                AND s.status = 'active') AS product_count
       FROM categories c
      ORDER BY c.name`,
  );

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    productCount: Number(r.product_count),
  }));
}

export type CategoryUpdateResult =
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string>; message?: string };

export async function updateCategory({
  categoryId,
  input,
  actor,
}: {
  categoryId: string;
  input: CategoryFormValues;
  actor: string;
}): Promise<CategoryUpdateResult> {
  const validated = validateCategoryEdit(input);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  const v = validated.value;

  const conn = await client();
  try {
    await conn.query("BEGIN");

    const current = await conn.query<{ name: string; slug: string }>(
      `SELECT name, slug FROM categories WHERE id = $1 FOR UPDATE`,
      [categoryId],
    );
    if (current.rows.length === 0) {
      await conn.query("ROLLBACK");
      return { ok: false, errors: {}, message: "That category no longer exists." };
    }

    // Checked against the rows rather than left to the unique index, because a
    // constraint violation arrives as a pg error name and this screen can say
    // "another category already uses that slug" instead.
    const clash = await conn.query<{ id: string }>(
      `SELECT id FROM categories
        WHERE slug = $1 AND id <> $2`,
      [v.slug, categoryId],
    );
    if (clash.rows.length > 0) {
      await conn.query("ROLLBACK");
      return {
        ok: false,
        errors: { slug: "Another category already uses that slug." },
      };
    }

    await conn.query(
      `UPDATE categories SET name = $2, slug = $3 WHERE id = $1`,
      [categoryId, v.name, v.slug],
    );
    await conn.query("COMMIT");

    const slugChanged = current.rows[0].slug !== v.slug;
    const nameChanged = current.rows[0].name !== v.name;

    if (slugChanged || nameChanged) {
      const { recordAdminAction } = await import("@/lib/admin-audit");
      await recordAdminAction({
        actor,
        action: "category_update",
        target: current.rows[0].slug,
        note: slugChanged
          ? `slug ${current.rows[0].slug} → ${v.slug}; old links will stop working. Name: ${
              current.rows[0].name
            } → ${v.name}`
          : `name ${current.rows[0].name} → ${v.name}`,
      });
    }

    return {
      ok: true,
      message: slugChanged
        ? `Saved. The public URL is now /category/${v.slug} — any old links to /category/${current.rows[0].slug} will stop working.`
        : "Saved.",
    };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    console.error("updateCategory failed", err);
    return { ok: false, errors: {}, message: "That could not be saved. Try again." };
  } finally {
    conn.release();
  }
}
