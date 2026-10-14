"use client";

import { useActionState, useState } from "react";
import { updateCategoryAction } from "@/app/actions/admin/categories";
import type { CategoryUpdateResult } from "@/lib/admin-categories";

/*
  One category, editable in place.

  Controlled inputs, so a rejected save keeps what was typed — the same reason
  ProductEditForm is controlled. Action state is not keyed or reset anywhere,
  so the "Saved." message survives the revalidation that proves it.

  The slug field carries the warning that matters on this screen. It is the
  URL, and it is linked from the header rail, the footer and every product
  page.
*/

type Props = {
  category: {
    id: string;
    name: string;
    slug: string;
    productCount: number;
  };
};

export function CategoryEditRow({ category }: Props) {
  const [name, setName] = useState(category.name);
  const [slug, setSlug] = useState(category.slug);

  const [state, formAction, pending] = useActionState<CategoryUpdateResult | null, FormData>(
    async (_previous, formData) => updateCategoryAction(category.id, formData),
    null,
  );

  const errors = state && !state.ok ? state.errors : {};
  const message = state ? state.message : null;

  const field =
    "h-11 w-full rounded-control border border-hairline bg-card px-3 text-base text-ink";
  const invalid = "border-sale";

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`category-name-${category.id}`}
            className="mb-1 block text-xs font-medium text-ink-3"
          >
            Name
          </label>
          <input
            id={`category-name-${category.id}`}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={`${field} ${errors.name ? invalid : ""}`}
          />
          {errors.name && (
            <p role="alert" className="mt-1 text-sm font-medium text-sale">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor={`category-slug-${category.id}`}
            className="mb-1 block text-xs font-medium text-ink-3"
          >
            Slug
          </label>
          <input
            id={`category-slug-${category.id}`}
            name="slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            className={`${field} ${errors.slug ? invalid : ""}`}
          />
          <p className="mt-1 text-xs text-ink-3">
            Public URL: /category/{slug || category.slug}
          </p>
          {errors.slug && (
            <p role="alert" className="mt-1 text-sm font-medium text-sale">
              {errors.slug}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-control bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-2 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <span className="text-xs text-ink-3">
          {category.productCount} product{category.productCount === 1 ? "" : "s"} in this
          category
        </span>
      </div>

      {message && (
        <p
          role={state && !state.ok ? "alert" : "status"}
          className={`text-sm font-medium ${
            state && !state.ok ? "text-sale" : "text-ink-2"
          }`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
