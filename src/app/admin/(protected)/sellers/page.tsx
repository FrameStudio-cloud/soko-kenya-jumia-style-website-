import {
  getSellerStatusCounts,
  listAdminSellers,
  SELLER_STATUS_LABEL,
  type AdminSellerStatus,
} from "@/lib/admin-sellers";
import { SellerActions } from "@/components/admin/SellerActions";

export const dynamic = "force-dynamic";

/*
  Seller moderation.

  The suspension here is the one place in the console that changes what the
  whole site can sell, and it is worth saying what it does not do: nothing is
  deleted, no product is edited, no order is touched. It moves one column and
  every catalogue read filters on it, so the products come back exactly as they
  were the moment the seller is reinstated.

  No phone number appears on this page. That is deliberate — see admin-sellers.ts.
*/

function parseStatus(raw: string | undefined): "all" | AdminSellerStatus | undefined {
  if (raw === "active" || raw === "suspended") return raw;
  return raw ? undefined : "all";
}

function parseVerified(raw: string | undefined): "all" | "yes" | "no" {
  return raw === "yes" || raw === "no" ? raw : "all";
}

function buildHref(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value !== "all") sp.set(key, value);
  }
  const qs = sp.toString();
  return `/admin/sellers${qs ? `?${qs}` : ""}`;
}

export default async function AdminSellersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; verified?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const verified = parseVerified(params.verified);
  const q = params.q?.trim() ?? "";

  const [counts, sellers] = await Promise.all([
    getSellerStatusCounts(),
    listAdminSellers({ status, verified, q }),
  ]);

  const allCount = counts.reduce((sum, c) => sum + c.count, 0);
  const activeCount = counts.find((c) => c.status === "active")?.count ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Sellers</h1>
        <p className="mt-1 text-sm text-ink-2">
          {allCount} seller{allCount === 1 ? "" : "s"} · {activeCount} trading ·{" "}
          {allCount - activeCount} suspended
        </p>
      </div>

      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-1">
          <li>
            <a
              href={buildHref({ verified, q })}
              className={`flex h-11 items-center rounded-control px-3 text-sm font-medium ${
                !status || status === "all" ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"
              }`}
            >
              All <span className="ml-2 text-xs opacity-70">{allCount}</span>
            </a>
          </li>
          {(["active", "suspended"] as const).map((value) => (
            <li key={value}>
              <a
                href={buildHref({ status: value, verified, q })}
                className={`flex h-11 items-center rounded-control px-3 text-sm font-medium ${
                  status === value ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"
                }`}
              >
                {SELLER_STATUS_LABEL[value]}
                <span className="ml-2 text-xs opacity-70">
                  {counts.find((c) => c.status === value)?.count ?? 0}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="status" value={status ?? ""} />
        <div>
          <label htmlFor="seller-q" className="mb-1 block text-xs font-medium text-ink-3">
            Search
          </label>
          <input
            id="seller-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name or slug"
            className="h-11 w-56 rounded-control border border-hairline bg-card px-3 text-base text-ink"
          />
        </div>
        <div>
          <label htmlFor="seller-verified" className="mb-1 block text-xs font-medium text-ink-3">
            Verification
          </label>
          <select
            id="seller-verified"
            name="verified"
            defaultValue={verified}
            className="h-11 rounded-control border border-hairline bg-card px-3 text-base text-ink"
          >
            <option value="all">Any</option>
            <option value="yes">Verified</option>
            <option value="no">Not verified</option>
          </select>
        </div>
        <button
          type="submit"
          className="h-11 rounded-control bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-2"
        >
          Apply
        </button>
        {(q || verified !== "all" || (status && status !== "all")) && (
          <a
            href="/admin/sellers"
            className="flex h-11 items-center rounded-control px-3 text-sm font-medium text-ink-2 hover:bg-canvas"
          >
            Clear
          </a>
        )}
      </form>

      {sellers.length === 0 ? (
        <p className="rounded-card border-l-4 border-l-alert bg-alert-tint p-5 text-sm text-ink-2">
          No sellers match these filters.
        </p>
      ) : (
        <div className="space-y-4">
          {sellers.map((seller) => (
            <div key={seller.id} className="rounded-card bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold">{seller.name}</h2>
                    {seller.status === "suspended" && (
                      <span className="rounded-sm bg-sale px-2 py-0.5 text-xs font-semibold text-white">
                        Suspended
                      </span>
                    )}
                    {seller.isVerified && (
                      <span className="rounded-sm bg-ink px-2 py-0.5 text-xs font-semibold text-white">
                        Verified
                      </span>
                    )}
                    {seller.isOfficialStore && (
                      <span className="rounded-sm border border-hairline px-2 py-0.5 text-xs font-semibold text-ink-2">
                        Official store
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-3">
                    /seller/{seller.slug} · {seller.location} · joined {seller.joinedYear} ·{" "}
                    {seller.productCount} product{seller.productCount === 1 ? "" : "s"} ·{" "}
                    {seller.ratingCount} rating{seller.ratingCount === 1 ? "" : "s"} · on-time{" "}
                    {Math.round(seller.onTimeRate * 100)}%
                  </p>

                  {seller.status === "suspended" && (
                    <div className="mt-3 rounded-card border-l-4 border-l-sale bg-alert-tint p-3 text-sm">
                      <p className="font-semibold text-sale">Suspended</p>
                      {seller.suspendedAt && (
                        <p className="text-xs text-ink-2">
                          {new Date(seller.suspendedAt).toLocaleDateString("en-KE", {
                            dateStyle: "medium",
                          })}
                        </p>
                      )}
                      {/*
                        The reason is staff-only and stays that way. Every
                        storefront query selects specific columns from this
                        table and none of them include it.
                      */}
                      {seller.suspensionReason && (
                        <p className="mt-1 text-sm text-ink-2">{seller.suspensionReason}</p>
                      )}
                    </div>
                  )}
                </div>

                <SellerActions
                  seller={{
                    id: seller.id,
                    name: seller.name,
                    isVerified: seller.isVerified,
                    status: seller.status,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
