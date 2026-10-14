export function formatPrice(kes: number): string {
  return `KSh ${Math.round(kes).toLocaleString("en-KE")}`;
}

/**
 * Discount as a whole number, or null when the item is not actually
 * discounted. We never render "-3%" off a rounding artefact.
 */
export function discountPercent(
  price: number,
  compareAtPrice: number | null,
): number | null {
  if (compareAtPrice === null || compareAtPrice <= price) return null;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}

export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

/**
 * "1.2k" / "840". Keeps rating counts from stretching a card's layout,
 * which is where Jumia's cards jump around as counts change width.
 */
export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}

/**
 * Object key -> something an <img> can load.
 *
 * The key is stored endpoint-free on purpose (see ProductRow.imageKey), so
 * this is the ONE place that knows where product imagery lives.
 *
 * Today the seeded keys are files in public/: `products/x.svg` is served at
 * `/products/x.svg`, so a key needs nothing but a leading slash. When imagery
 * moves to Neon Object Storage the bucket goes in here and nowhere else —
 * the keys, the callers and the <img> tags all stay as they are.
 *
 * Null in, null out, so a caller falls back to its placeholder instead of
 * emitting `src=""`, which a browser resolves to the page URL and logs.
 */
export function imageUrl(key: string | null): string | null {
  if (!key) return null;
  // An absolute URL is honoured as-is, for keys minted by an upload path that
  // returns one.
  if (/^https?:\/\//i.test(key)) return key;
  return key.startsWith("/") ? key : `/${key}`;
}