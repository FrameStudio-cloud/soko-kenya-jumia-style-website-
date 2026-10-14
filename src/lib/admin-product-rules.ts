/*
  Product catalogue rules, with no database in them.

  Same split as admin-order-rules.ts, and for the same reason: ProductEditForm
  is a client component that needs the status list and the labels, and a module
  that also holds queries imports @/db, which is pg, which imports `dns`.
  Phase 2 learned that from a failed build; this file exists so Phase 3 does not
  repeat it.

  Validation lives here rather than in the action because it is the same
  validation whether it runs on a form post or against a fixture in a test —
  and because the database's CHECK constraints are a backstop that produces
  constraint names, not sentences a human can act on.

  What the database enforces (products_* constraints), and therefore what this
  must catch first, with a message:

    products_price_positive        price > 0
    products_compare_at_greater    compare_at_price IS NULL OR > price
    products_stock_nonneg          stock >= 0
    products_stock_reserved_nonneg stock_reserved >= 0
    products_reserved_not_over_stock  stock_reserved <= stock
    products_slug_key              slug is unique

  That last pair is the one that surprises: stock cannot be lowered below the
  units already held in live carts. An operator who drops stock from 10 to 2
  while three units are reserved would be taking stock away from people who
  already have it in a basket, and the CHECK refuses it.
*/

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

/**
 * What the public catalogue does with each status.
 *
 * Every read path in src/lib/queries.ts already filters `p.status = 'active'`,
 * so this is not a rule the admin screen introduces — it is one it inherits.
 * Archiving therefore unpublishes immediately, with no extra work.
 */
export const PRODUCT_STATUS_EFFECT: Record<ProductStatus, string> = {
  draft: "Hidden from the catalogue and search",
  active: "Visible, purchasable, appears in search",
  archived: "Removed from the catalogue; kept with its orders",
};

/* ----------------------------------------------------------------- input --- */

export type ProductFormValues = {
  title: string;
  slug: string;
  description: string;
  brand: string;
  price: string;
  compareAtPrice: string;
  stock: string;
  deliveryFee: string;
  deliveryEstimateDays: string;
  categoryId: string;
  sellerId: string;
  status: string;
};

export type ValidatedProduct = {
  title: string;
  slug: string;
  description: string | null;
  brand: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  deliveryFee: number;
  deliveryEstimateDays: number | null;
  categoryId: string;
  sellerId: string;
  status: ProductStatus;
};

/**
 * Read a FormData without assuming every field arrived.
 *
 * A missing field must become an empty string rather than `undefined`, or
 * `undefined.trim()` throws before any validation can run — and a thrown error
 * in an action shows the operator a stack trace instead of a form.
 */
export function parseProductForm(formData: FormData): ProductFormValues {
  const read = (name: string): string =>
    (formData.get(name) as string | null) ?? "";

  return {
    title: read("title"),
    slug: read("slug"),
    description: read("description"),
    brand: read("brand"),
    price: read("price"),
    compareAtPrice: read("compareAtPrice"),
    stock: read("stock"),
    deliveryFee: read("deliveryFee"),
    deliveryEstimateDays: read("deliveryEstimateDays"),
    categoryId: read("categoryId"),
    sellerId: read("sellerId"),
    status: read("status"),
  };
}

/**
 * Money from a text field: "42,000", " 42000.50 " and "42000" all parse.
 *
 * Returns null rather than NaN so "this is not a number" can be distinguished
 * from "this is zero", which is a different sentence for the operator.
 */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value;
}

export function parseInteger(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stored product row as editable text.
 *
 * Lives here rather than in ProductEditForm because the server-rendered detail
 * page builds the initial values too, and a server component must not import
 * from a "use client" module — that direction only works one way.
 *
 * Numbers become plain strings, not formatted currency: an input showing
 * "KSh 42,000" invites someone to type a currency symbol into a numeric column.
 */
export function toFormValues(product: {
  title: string;
  slug: string;
  description: string | null;
  brand: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  deliveryFee: number;
  deliveryEstimateDays: number | null;
  categoryId: string;
  sellerId: string;
  status: string;
}): ProductFormValues {
  return {
    title: product.title,
    slug: product.slug,
    description: product.description ?? "",
    brand: product.brand ?? "",
    price: String(product.price),
    compareAtPrice: product.compareAtPrice === null ? "" : String(product.compareAtPrice),
    stock: String(product.stock),
    deliveryFee: String(product.deliveryFee),
    deliveryEstimateDays:
      product.deliveryEstimateDays === null ? "" : String(product.deliveryEstimateDays),
    categoryId: product.categoryId,
    sellerId: product.sellerId,
    status: product.status,
  };
}

/*
  Slugs stay ASCII on purpose. The public URL is /product/[slug], and a slug
  containing a space or a slash produces a link that only works if every layer
  encodes it the same way. Slugified-by-hand links are already in the wild, so
  accepting only the narrow shape keeps them stable rather than "fixing" them.

  Exported because a category slug lands in the same kind of URL and must obey
  the same rules. admin-moderation-rules.ts imports it rather than keeping a
  second copy that could drift.
*/
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* ------------------------------------------------------------- validate --- */

export type ValidationResult =
  | { ok: true; value: ValidatedProduct }
  | { ok: false; errors: Record<string, string> };

/** numeric(12,2) — the largest amount this column can hold. */
const MAX_MONEY = 9999999999.99;
const MAX_TITLE = 200;
export const MAX_SLUG = 120;

export function validateProductEdit(
  input: ProductFormValues,
  context: { stockReserved: number },
): ValidationResult {
  const errors: Record<string, string> = {};

  const title = input.title.trim();
  if (!title) {
    errors.title = "A product needs a title.";
  } else if (title.length > MAX_TITLE) {
    errors.title = `Keep the title to ${MAX_TITLE} characters or fewer.`;
  }

  const slug = input.slug.trim().toLowerCase();
  if (!slug) {
    errors.slug = "A product needs a slug.";
  } else if (slug.length > MAX_SLUG) {
    errors.slug = `Keep the slug to ${MAX_SLUG} characters or fewer.`;
  } else if (!SLUG_RE.test(slug)) {
    errors.slug =
      "Use lowercase letters, numbers and single hyphens only — no spaces.";
  }

  const price = parseMoney(input.price);
  if (price === null) {
    errors.price = "Enter a price as a number, e.g. 42000.";
  } else if (price <= 0) {
    // products_price_positive
    errors.price = "The price has to be above zero.";
  } else if (price > MAX_MONEY) {
    errors.price = "That price is too large to store.";
  }

  /*
    compare_at_price must be strictly above price — the schema comment is
    blunt about why: a row equal to the price would let the site strike
    through the real price and claim a 0% saving. An empty field means
    "never discounted", which is the honest default.
  */
  const compareRaw = input.compareAtPrice.trim();
  let compareAtPrice: number | null = null;
  if (compareRaw !== "") {
    compareAtPrice = parseMoney(compareRaw);
    if (compareAtPrice === null) {
      errors.compareAtPrice = "Enter a number, or leave it empty for no sale price.";
    } else if (compareAtPrice <= 0) {
      errors.compareAtPrice = "A sale price has to be above zero.";
    } else if (price !== null && compareAtPrice <= price) {
      // products_compare_at_greater
      errors.compareAtPrice =
        "The old price must be higher than what you are charging now — otherwise it is a 0% discount.";
    }
  }

  const stock = parseInteger(input.stock);
  if (stock === null) {
    errors.stock = "Enter a whole number of units.";
  } else if (stock < 0) {
    // products_stock_nonneg
    errors.stock = "Stock cannot be negative.";
  } else if (stock < context.stockReserved) {
    /*
      products_reserved_not_over_stock. The one worth explaining: these units
      are in somebody's basket right now, so lowering the count below them
      would take stock away from a shopper who already added it.
    */
    errors.stock = `${context.stockReserved} unit${
      context.stockReserved === 1 ? " is" : "s are"
    } held in live carts. You cannot drop stock below ${
      context.stockReserved
    } until those carts expire or are checked out.`;
  }

  const deliveryFee = parseMoney(input.deliveryFee);
  if (deliveryFee === null) {
    errors.deliveryFee = "Enter a delivery fee, or 0 for free.";
  } else if (deliveryFee < 0) {
    errors.deliveryFee = "A delivery fee cannot be negative.";
  } else if (deliveryFee > MAX_MONEY) {
    errors.deliveryFee = "That delivery fee is too large to store.";
  }

  const deliveryRaw = input.deliveryEstimateDays.trim();
  let deliveryEstimateDays: number | null = null;
  if (deliveryRaw !== "") {
    deliveryEstimateDays = parseInteger(deliveryRaw);
    if (deliveryEstimateDays === null || deliveryEstimateDays < 0) {
      errors.deliveryEstimateDays = "Enter a whole number of days, or leave it empty.";
    }
  }

  if (!input.categoryId || !UUID_RE.test(input.categoryId)) {
    errors.categoryId = "Choose a category.";
  }
  if (!input.sellerId || !UUID_RE.test(input.sellerId)) {
    errors.sellerId = "Choose a seller.";
  }

  if (!PRODUCT_STATUSES.includes(input.status as ProductStatus)) {
    errors.status = "Choose a status.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  /*
    price, stock and deliveryFee are non-null here because a null set one of
    the errors above, and that branch has just returned. TypeScript cannot
    correlate `Object.keys(errors).length > 0` with "price is null", so the
    assertion restates what the checks above guarantee rather than hiding it.
  */
  return {
    ok: true,
    value: {
      title,
      slug,
      description: input.description.trim() || null,
      brand: input.brand.trim() || null,
      price: price as number,
      compareAtPrice,
      stock: stock as number,
      deliveryFee: deliveryFee as number,
      deliveryEstimateDays,
      categoryId: input.categoryId,
      sellerId: input.sellerId,
      status: input.status as ProductStatus,
    },
  };
}
