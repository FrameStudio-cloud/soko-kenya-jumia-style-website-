import Link from "next/link";
import {
  getAdminChoices,
  getProductStatusCounts,
  listAdminProducts,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABEL,
  type ProductStatus,
} from "@/lib/admin-products";
import { formatPrice, imageUrl } from "@/lib/format";

export const dynamic = "force-dynamic";

const PER_PAGE = 25;

/*
  Filters come from the URL, never from component state.

  Same rule the public search applies: a filtered list is shareable, survives a
  refresh, and can be server-rendered. A filter held only in state would make
  this a client fetch and add a loading state to every page that has one.
*/

/** Range-check the status before it can reach SQL. */
function parseStatus(raw: string | undefined): ProductStatus | undefined {
  return PRODUCT_STATUSES.find((s) => s === raw);
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function buildHref(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  const qs = sp.toString();
  return `/admin/products${qs ? `?${qs}` : ""}`;
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; seller?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const q = params.q?.trim() ?? "";
  const seller = params.seller?.trim() ?? "";
  const page = parsePage(params.page);

  const [counts, choices, { rows, total }] = await Promise.all([
    getProductStatusCounts(),
    getAdminChoices(),
    listAdminProducts({ status, q, sellerId: seller, page, perPage: PER_PAGE }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const allCount = counts.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="mt-1 text-sm text-ink-2">
          {allCount} product{allCount === 1 ? "" : "s"} in the catalogue
        </p>
      </div>

      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-1">
          <li>
            <Link
              href={buildHref({ q, seller })}
              className={`flex h-11 items-center rounded-control px-3 text-sm font-medium ${
                status === undefined ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"
              }`}
            >
              All <span className="ml-2 text-xs opacity-70">{allCount}</span>
            </Link>
          </li>
          {PRODUCT_STATUSES.map((value) => (
            <li key={value}>
              <Link
                href={buildHref({ status: value, q, seller })}
                className={`flex h-11 items-center rounded-control px-3 text-sm font-medium ${
                  status === value ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"
                }`}
              >
                {PRODUCT_STATUS_LABEL[value]}
                <span className="ml-2 text-xs opacity-70">
                  {counts.find((c) => c.status === value)?.count ?? 0}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/*
        A plain GET form, so filtering works with JavaScript off and the result
        is a real URL. `status` is carried in a hidden field so switching text
        or seller does not silently drop the tab the operator is on.
      */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="status" value={status ?? ""} />
        <div>
          <label htmlFor="product-q" className="mb-1 block text-xs font-medium text-ink-3">
            Search
          </label>
          <input
            id="product-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Title, brand or slug"
            className="h-11 w-56 rounded-control border border-hairline bg-card px-3 text-base text-ink"
          />
        </div>
        <div>
          <label htmlFor="product-seller" className="mb-1 block text-xs font-medium text-ink-3">
            Seller
          </label>
          <select
            id="product-seller"
            name="seller"
            defaultValue={seller}
            className="h-11 rounded-control border border-hairline bg-card px-3 text-base text-ink"
          >
            <option value="">Any seller</option>
            {choices.sellers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {/* A suspended seller's products are still in the catalogue and
                    still need editing, so they stay in the filter. */}
                {option.status === "suspended" ? " (suspended)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-11 rounded-control bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-2"
        >
          Apply
        </button>
        {(q || seller || status) && (
          <Link
            href="/admin/products"
            className="flex h-11 items-center rounded-control px-3 text-sm font-medium text-ink-2 hover:bg-canvas"
          >
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-card border-l-4 border-l-alert bg-alert-tint p-5 text-sm text-ink-2">
          No products match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card bg-card shadow-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Products, most recently updated first</caption>
            <thead className="border-b border-hairline-2 text-xs uppercase tracking-wide text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-3">Product</th>
                <th scope="col" className="px-4 py-3">Seller</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3 text-right">Price</th>
                <th scope="col" className="px-4 py-3 text-right">Stock</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-2">
              {rows.map((product) => {
                const held = product.stockReserved;
                const available = product.stock - held;
                const src = imageUrl(product.imageKey);

                return (
                  <tr key={product.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-sm bg-canvas">
                          {src ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={src}
                              alt=""
                              width={40}
                              height={40}
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/admin/products/${product.id}`}
                            className="block truncate font-semibold hover:text-brand hover:underline"
                          >
                            {product.title}
                          </Link>
                          <span className="block truncate text-xs text-ink-3">{product.slug}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{product.sellerName}</td>
                    <td className="px-4 py-3 text-ink-2">{product.categoryName}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {formatPrice(product.price)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={available <= 3 ? "font-semibold text-sale" : undefined}>
                        {available}
                      </span>
                      {held > 0 && (
                        <span className="block text-xs text-ink-3">
                          {held} held in carts
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{PRODUCT_STATUS_LABEL[product.status]}</td>
                    <td className="px-4 py-3 text-ink-2">
                      {new Date(product.updatedAt).toLocaleDateString("en-KE", {
                        dateStyle: "medium",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-2">
          {page > 1 && (
            <Link
              href={buildHref({ status, q, seller, page: String(page - 1) })}
              className="flex h-11 items-center rounded-control px-3 text-sm font-medium text-ink-2 hover:bg-canvas"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-ink-3">
            Page {page} of {pageCount}
          </span>
          {page < pageCount && (
            <Link
              href={buildHref({ status, q, seller, page: String(page + 1) })}
              className="flex h-11 items-center rounded-control px-3 text-sm font-medium text-ink-2 hover:bg-canvas"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
