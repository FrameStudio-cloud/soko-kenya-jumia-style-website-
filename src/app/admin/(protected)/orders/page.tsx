import Link from "next/link";
import { listAdminOrders, ORDER_STATUSES, STATUS_LABEL, type OrderStatus } from "@/lib/admin-orders";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

const PER_PAGE = 25;

/*
  Range-check the status here rather than passing the query string through.

  Same rule parseFilters applies to the catalogue: a value from the URL is
  untrusted, and every value that reaches SQL must have been checked against the
  set of real ones. `/admin/orders?status=deleted` shows all orders, not an
  error — quietly ignoring it is friendlier than 400, and identical to what the
  public search already does with a bad filter.
*/
function parseStatus(raw: string | undefined): OrderStatus | undefined {
  return ORDER_STATUSES.find((s) => s === raw);
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const page = parsePage(params.page);

  const { rows, total } = await listAdminOrders({ status, page, perPage: PER_PAGE });
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="mt-1 text-sm text-ink-2">
          {total} matching order{total === 1 ? "" : "s"}
          {status ? ` · ${STATUS_LABEL[status]}` : ""}
        </p>
      </div>

      {/* Plain links, not a form: a filtered URL stays shareable and works without JS. */}
      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-1">
          <li>
            <Link
              href="/admin/orders"
              className={`flex h-11 items-center rounded-control px-3 text-sm font-medium ${
                status === undefined ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"
              }`}
            >
              All
            </Link>
          </li>
          {ORDER_STATUSES.map((value) => (
            <li key={value}>
              <Link
                href={`/admin/orders?status=${value}`}
                className={`flex h-11 items-center rounded-control px-3 text-sm font-medium ${
                  status === value ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"
                }`}
              >
                {STATUS_LABEL[value]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-card border-l-4 border-l-alert bg-alert-tint p-5 text-sm text-ink-2">
          No orders match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card bg-card shadow-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Orders, most recent first
            </caption>
            <thead className="border-b border-hairline-2 text-xs uppercase tracking-wide text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-3">Reference</th>
                <th scope="col" className="px-4 py-3">Placed</th>
                <th scope="col" className="px-4 py-3">Seller</th>
                <th scope="col" className="px-4 py-3">County</th>
                <th scope="col" className="px-4 py-3">Items</th>
                <th scope="col" className="px-4 py-3 text-right">Total</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-2">
              {rows.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/orders/${order.reference}`}
                      className="font-semibold hover:text-brand hover:underline"
                    >
                      {order.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-2">
                    {new Date(order.createdAt).toLocaleString("en-KE", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-4 py-3">{order.sellerName}</td>
                  <td className="px-4 py-3">{order.county}</td>
                  <td className="px-4 py-3 text-ink-2">{order.itemCount}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {formatPrice(order.grandTotal)}
                  </td>
                  <td className="px-4 py-3">{STATUS_LABEL[order.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-2">
          {page > 1 && (
            <Link
              href={`/admin/orders?${status ? `status=${status}&` : ""}page=${page - 1}`}
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
              href={`/admin/orders?${status ? `status=${status}&` : ""}page=${page + 1}`}
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