"use client";

import { useActionState, useState } from "react";
import { updateProductAction } from "@/app/actions/admin/products";
import type { ProductUpdateResult } from "@/lib/admin-products";
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_EFFECT,
  PRODUCT_STATUS_LABEL,
  toFormValues,
  type ProductFormValues,
  type ProductStatus,
} from "@/lib/admin-product-rules";

/*
  The product editor.

  Two things about this form are deliberate.

  1. VALUES ARE CONTROLLED, not defaultValue. React 19 resets a form after its
     action completes — which is right for a login box and wrong here, because
     the first attempt at saving a price is often the one that fails
     validation, and wiping everything the operator typed because one field was
     wrong is hostile.

  2. THE FORM HAS A `key` = updatedAt. On a successful save the server
     revalidates, updatedAt changes, and the component remounts with the fresh
     rows from the database. On a failed save nothing revalidates, the key is
     unchanged, no remount happens, and the typed values survive to be corrected.
     That is the whole mechanism — no effect, no syncing state to props.

  Fields marked "required" in the schema are still validated server-side. The
  red text comes back from validateProductEdit(), never from this file: rules
  that exist only in the browser are presentation, not controls.
*/

type Props = {
  productId: string;
  initial: ProductFormValues;
  initialUpdatedAt: string;
  stockReserved: number;
  categories: Array<{ id: string; name: string }>;
  sellers: Array<{ id: string; name: string }>;
};

export function ProductEditForm({
  productId,
  initial,
  initialUpdatedAt,
  stockReserved,
  categories,
  sellers,
}: Props) {
  const [values, setValues] = useState<ProductFormValues>(initial);
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(initialUpdatedAt);

  const [state, formAction, pending] = useActionState<ProductUpdateResult | null, FormData>(
    async (_previous, formData) => updateProductAction(productId, formData),
    null,
  );

  /*
    Adopt the rows the database just wrote — but compare a scalar, not the
    object, because `initial` is a fresh object on every render and a reference
    comparison would reset the form constantly.

    After a successful save the server revalidates, `updatedAt` moves, and this
    runs so the operator sees what was actually stored rather than what they
    typed: a trimmed description, a lowercased slug.

    After a FAILED save nothing revalidates, `updatedAt` is unchanged, this
    never fires, and the typed values survive.

    Action state is deliberately untouched. This used to be a `key={updatedAt}`
    on the form, which remounted the component and reset `useActionState` — so a
    save that worked showed nothing at all. The write landed and the operator
    got no confirmation, which reads exactly like a silent failure.
  */
  if (initialUpdatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(initialUpdatedAt);
    setValues(initial);
  }

  const errors = state && !state.ok ? (state.errors ?? {}) : {};
  const message = state ? state.message : null;

  function set(name: keyof ProductFormValues, value: string) {
    setValues((previous) => ({ ...previous, [name]: value }));
  }

  const fieldClass = (name: string) =>
    `h-11 w-full rounded-control border bg-card px-3 text-base text-ink ${
      errors[name] ? "border-sale" : "border-hairline"
    }`;

  const errorFor = (name: string) =>
    errors[name] ? (
      <p className="mt-1 text-sm font-medium text-sale">{errors[name]}</p>
    ) : null;

  const labelClass = "mb-1 block text-sm font-medium";

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="f-title" className={labelClass}>
          Title
        </label>
        <input
          id="f-title"
          name="title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          className={fieldClass("title")}
        />
        {errorFor("title")}
      </div>

      <div>
        <label htmlFor="f-slug" className={labelClass}>
          Slug
        </label>
        <input
          id="f-slug"
          name="slug"
          value={values.slug}
          onChange={(e) => set("slug", e.target.value)}
          className={fieldClass("slug")}
        />
        {errorFor("slug")}
        <p className="mt-1 text-xs text-ink-3">
          Public URL: /product/{values.slug}
          {values.slug !== initial.slug && (
            <span className="text-sale">
              {" "}
              — changing this breaks any existing links to this product.
            </span>
          )}
        </p>
      </div>

      <div>
        <label htmlFor="f-description" className={labelClass}>
          Description
        </label>
        <textarea
          id="f-description"
          name="description"
          rows={5}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          className="w-full rounded-control border border-hairline bg-card px-3 py-2 text-base text-ink"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="f-brand" className={labelClass}>
            Brand
          </label>
          <input
            id="f-brand"
            name="brand"
            value={values.brand}
            onChange={(e) => set("brand", e.target.value)}
            className={fieldClass("brand")}
          />
        </div>

        <div>
          <label htmlFor="f-categoryId" className={labelClass}>
            Category
          </label>
          <select
            id="f-categoryId"
            name="categoryId"
            value={values.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            className={fieldClass("categoryId")}
          >
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {errorFor("categoryId")}
        </div>

        <div>
          <label htmlFor="f-sellerId" className={labelClass}>
            Seller
          </label>
          <select
            id="f-sellerId"
            name="sellerId"
            value={values.sellerId}
            onChange={(e) => set("sellerId", e.target.value)}
            className={fieldClass("sellerId")}
          >
            {sellers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {errorFor("sellerId")}
        </div>

        <div>
          <label htmlFor="f-price" className={labelClass}>
            Price (KSh)
          </label>
          <input
            id="f-price"
            name="price"
            inputMode="decimal"
            value={values.price}
            onChange={(e) => set("price", e.target.value)}
            className={fieldClass("price")}
          />
          {errorFor("price")}
        </div>

        <div>
          <label htmlFor="f-compareAtPrice" className={labelClass}>
            Was price (KSh)
          </label>
          <input
            id="f-compareAtPrice"
            name="compareAtPrice"
            inputMode="decimal"
            placeholder="Empty = never discounted"
            value={values.compareAtPrice}
            onChange={(e) => set("compareAtPrice", e.target.value)}
            className={fieldClass("compareAtPrice")}
          />
          {errorFor("compareAtPrice")}
        </div>

        <div>
          <label htmlFor="f-stock" className={labelClass}>
            Stock on hand
          </label>
          <input
            id="f-stock"
            name="stock"
            inputMode="numeric"
            value={values.stock}
            onChange={(e) => set("stock", e.target.value)}
            className={fieldClass("stock")}
          />
          {errorFor("stock")}
          <p className="mt-1 text-xs text-ink-3">
            {stockReserved > 0
              ? `${stockReserved} unit${stockReserved === 1 ? " is" : "s are"} held in live carts right now, so the lowest you can set is ${stockReserved}.`
              : "No units are currently held in carts."}
          </p>
        </div>

        <div>
          <label htmlFor="f-deliveryFee" className={labelClass}>
            Delivery fee (KSh)
          </label>
          <input
            id="f-deliveryFee"
            name="deliveryFee"
            inputMode="decimal"
            value={values.deliveryFee}
            onChange={(e) => set("deliveryFee", e.target.value)}
            className={fieldClass("deliveryFee")}
          />
          {errorFor("deliveryFee")}
        </div>

        <div>
          <label htmlFor="f-deliveryEstimateDays" className={labelClass}>
            Delivery estimate (days)
          </label>
          <input
            id="f-deliveryEstimateDays"
            name="deliveryEstimateDays"
            inputMode="numeric"
            placeholder="Empty = not stated"
            value={values.deliveryEstimateDays}
            onChange={(e) => set("deliveryEstimateDays", e.target.value)}
            className={fieldClass("deliveryEstimateDays")}
          />
          {errorFor("deliveryEstimateDays")}
        </div>
      </div>

      <div>
        <label htmlFor="f-status" className={labelClass}>
          Status
        </label>
        <select
          id="f-status"
          name="status"
          value={values.status}
          onChange={(e) => set("status", e.target.value)}
          className={fieldClass("status")}
        >
          {PRODUCT_STATUSES.map((option) => (
            <option key={option} value={option}>
              {PRODUCT_STATUS_LABEL[option]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-3">
          {PRODUCT_STATUS_EFFECT[values.status as ProductStatus] ?? ""}
        </p>
      </div>

      {message && (
        <p
          role={state && !state.ok ? "alert" : "status"}
          className={`rounded-control border-l-4 px-4 py-3 text-sm font-medium ${
            state && !state.ok
              ? "border-l-sale bg-sale-tint text-ink"
              : "border-l-brand bg-brand-tint text-ink"
          }`}
        >
          {message}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-hairline-2 pt-5">
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-control bg-ink px-6 text-base font-semibold text-white hover:bg-ink-2 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <p className="text-sm text-ink-3">
          There is no delete — archiving keeps the product and its order history.
        </p>
      </div>
    </form>
  );
}
