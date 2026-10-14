import { listAdminCategories } from "@/lib/admin-categories";
import { CategoryEditRow } from "@/components/admin/CategoryEditRow";

export const dynamic = "force-dynamic";

/*
  Category renaming.

  Rename and re-slug only. There is no create and no delete: `products.category_id`
  is `onDelete: restrict`, so a category holding products cannot be removed at
  all, and adding one is a content decision rather than a moderation one.

  The count shown per row is the number a shopper can actually see — active
  products from active sellers — so it agrees with the number on the category
  page rather than counting stock that is not for sale.
*/

export default async function AdminCategoriesPage() {
  const categories = await listAdminCategories();
  const total = categories.reduce((sum, c) => sum + c.productCount, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Categories</h1>
        <p className="mt-1 text-sm text-ink-2">
          {categories.length} categor{categories.length === 1 ? "y" : "ies"} · {total} visible
          product{total === 1 ? "" : "s"} across them
        </p>
      </div>

      <p className="rounded-card border-l-4 border-l-brand bg-canvas p-4 text-sm text-ink-2">
        Changing a slug changes the public URL. Links to{" "}
        <span className="font-semibold text-ink">/category/[old-slug]</span> will stop working —
        including the ones in the header, the footer and search results.
      </p>

      {categories.length === 0 ? (
        <p className="rounded-card border-l-4 border-l-alert bg-alert-tint p-5 text-sm text-ink-2">
          No categories.
        </p>
      ) : (
        <div className="space-y-4">
          {categories.map((category) => (
            <div key={category.id} className="rounded-card bg-card p-5 shadow-card">
              <CategoryEditRow category={category} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
