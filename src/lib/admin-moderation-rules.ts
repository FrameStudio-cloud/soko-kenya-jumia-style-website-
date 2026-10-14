import { MAX_SLUG, SLUG_RE, parseInteger, parseMoney } from "@/lib/admin-product-rules";

/*
  Moderation rules, with no database in them.

  The same split as admin-order-rules.ts and admin-product-rules.ts, for the
  same reason: the admin forms are client components that need validation
  messages and status labels, and a module that also holds queries imports
  @/db, which is pg, which imports `dns`. That broke a Phase 2 build.

  Parsing and the slug shape are imported from admin-product-rules rather than
  copied. A category slug and a product slug appear in the same kind of URL and
  must obey the same rules forever; two copies of that regex would eventually
  disagree, and the disagreement would surface as a link that works on one page
  and 404s on another.

  What the database enforces, and therefore what this must catch first with a
  sentence a human can act on:

    categories_slug_key            slug is unique
    delivery_areas_county_key      county is unique
    delivery_areas_eta_order       eta_days_min <= eta_days_max
*/

/* ---------------------------------------------------------------- shared --- */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** numeric(12,2) — the largest amount these money columns can hold. */
const MAX_MONEY = 9999999999.99;

export const isUuid = (value: string): boolean => UUID_RE.test(value);

/* ------------------------------------------------------------- suspension --- */

export const SUSPENSION_REASON_MAX = 500;

export type SuspensionResult =
  | { ok: true; reason: string }
  | { ok: false; message: string };

/**
 * Why a seller is being suspended, in the moderator's own words.
 *
 * Required on purpose. "Suspended" with no reason is a decision nobody can
 * review six months later, and the audit row is the only record of who made
 * it — which is also why this text must never reach a shopper. The schema is
 * blunt about it: staff-only, never rendered on a storefront.
 */
export function validateSuspensionReason(raw: string): SuspensionResult {
  const reason = raw.trim();
  if (!reason) {
    return {
      ok: false,
      message: "Say why this seller is being suspended — it is the only record of the decision.",
    };
  }
  if (reason.length > SUSPENSION_REASON_MAX) {
    return {
      ok: false,
      message: `Keep the reason to ${SUSPENSION_REASON_MAX} characters or fewer.`,
    };
  }
  return { ok: true, reason };
}

/* ------------------------------------------------------------- categories --- */

export type CategoryFormValues = {
  name: string;
  slug: string;
};

export type ValidatedCategory = {
  name: string;
  slug: string;
};

/** text column, but a category name longer than this is a paste accident. */
const MAX_CATEGORY_NAME = 120;

/**
 * Read a FormData without assuming every field arrived.
 *
 * A missing field has to become an empty string rather than undefined, or
 * `undefined.trim()` throws before validation can run — and a throw inside an
 * action shows the operator a stack trace where a form should be.
 */
export function parseCategoryForm(formData: FormData): CategoryFormValues {
  const read = (name: string): string =>
    (formData.get(name) as string | null) ?? "";
  return { name: read("name"), slug: read("slug") };
}

export type CategoryValidationResult =
  | { ok: true; value: ValidatedCategory }
  | { ok: false; errors: Record<string, string> };

export function validateCategoryEdit(input: CategoryFormValues): CategoryValidationResult {
  const errors: Record<string, string> = {};

  const name = input.name.trim();
  if (!name) {
    errors.name = "A category needs a name.";
  } else if (name.length > MAX_CATEGORY_NAME) {
    errors.name = `Keep the name to ${MAX_CATEGORY_NAME} characters or fewer.`;
  }

  const slug = input.slug.trim().toLowerCase();
  if (!slug) {
    errors.slug = "A category needs a slug — it is the URL.";
  } else if (slug.length > MAX_SLUG) {
    errors.slug = `Keep the slug to ${MAX_SLUG} characters or fewer.`;
  } else if (!SLUG_RE.test(slug)) {
    errors.slug = "Use lowercase letters, numbers and single hyphens only — no spaces.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, slug } };
}

/* --------------------------------------------------------- delivery areas --- */

export type DeliveryAreaFormValues = {
  baseFee: string;
  freeDeliveryThreshold: string;
  etaDaysMin: string;
  etaDaysMax: string;
  isActive: boolean;
};

export type ValidatedDeliveryArea = {
  baseFee: number;
  freeDeliveryThreshold: number | null;
  etaDaysMin: number;
  etaDaysMax: number;
  isActive: boolean;
};

/**
 * Read a FormData for a delivery area.
 *
 * The checkbox is the one field that is not a string: a checkbox that is
 * unticked sends nothing at all, so reading it as a string would leave
 * `isActive` as the literal "false" — truthy — and turning a county off would
 * silently turn it back on.
 */
export function parseDeliveryAreaForm(formData: FormData): DeliveryAreaFormValues {
  const read = (name: string): string =>
    (formData.get(name) as string | null) ?? "";
  return {
    baseFee: read("baseFee"),
    freeDeliveryThreshold: read("freeDeliveryThreshold"),
    etaDaysMin: read("etaDaysMin"),
    etaDaysMax: read("etaDaysMax"),
    isActive: formData.get("isActive") === "on",
  };
}

export type DeliveryAreaValidationResult =
  | { ok: true; value: ValidatedDeliveryArea }
  | { ok: false; errors: Record<string, string> };

export function validateDeliveryAreaEdit(
  input: DeliveryAreaFormValues,
): DeliveryAreaValidationResult {
  const errors: Record<string, string> = {};

  const baseFee = parseMoney(input.baseFee);
  if (baseFee === null) {
    errors.baseFee = "Enter a delivery fee as a number, or 0 for free.";
  } else if (baseFee < 0) {
    errors.baseFee = "A delivery fee cannot be negative.";
  } else if (baseFee > MAX_MONEY) {
    errors.baseFee = "That fee is too large to store.";
  }

  /*
    Empty means NULL: this county has no free-delivery threshold at all, and
    every basket pays the fee. That is a different fact from a threshold of 0,
    which means everything ships free — so 0 is accepted and stays 0 rather than
    being read as "unset".
  */
  const thresholdRaw = input.freeDeliveryThreshold.trim();
  let freeDeliveryThreshold: number | null = null;
  if (thresholdRaw !== "") {
    freeDeliveryThreshold = parseMoney(thresholdRaw);
    if (freeDeliveryThreshold === null) {
      errors.freeDeliveryThreshold = "Enter a number, or leave it empty for no threshold.";
    } else if (freeDeliveryThreshold < 0) {
      errors.freeDeliveryThreshold = "A free-delivery threshold cannot be negative.";
    } else if (freeDeliveryThreshold > MAX_MONEY) {
      errors.freeDeliveryThreshold = "That threshold is too large to store.";
    }
  }

  const etaDaysMin = parseInteger(input.etaDaysMin);
  if (etaDaysMin === null) {
    errors.etaDaysMin = "Enter a whole number of days.";
  } else if (etaDaysMin < 0) {
    errors.etaDaysMin = "An estimate cannot be negative — 0 means same day.";
  }

  const etaDaysMax = parseInteger(input.etaDaysMax);
  if (etaDaysMax === null) {
    errors.etaDaysMax = "Enter a whole number of days.";
  } else if (etaDaysMax < 0) {
    errors.etaDaysMax = "An estimate cannot be negative — 0 means same day.";
  } else if (etaDaysMin !== null && etaDaysMax < etaDaysMin) {
    // delivery_areas_eta_order
    errors.etaDaysMax = `The longest estimate cannot be shorter than the shortest (${etaDaysMin}).`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      baseFee: baseFee as number,
      freeDeliveryThreshold,
      etaDaysMin: etaDaysMin as number,
      etaDaysMax: etaDaysMax as number,
      isActive: input.isActive,
    },
  };
}
