import Link from "next/link";
import { getOrderStatusCounts, STATUS_LABEL } from "@/lib/admin-orders";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

/*
  Admin overview.

  Counts only. Deliberately no order content on this screen: an overview that
  renders customer details is a screen that leaks them to anyone who walks past
  a logged-in browser.
*/
export default async function AdminOverviewPage() {
  const counts = await getOrderStatusCounts();
  const total = counts.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="mt-1 text-sm text-ink-2">
          {total} order{total === 1 ? "" : "s"} on this branch.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {counts.map(({ status, count }) => (
          <li key={status}>
            <Link
              href={`/admin/orders?status=${status}`}
              className="flex items-center justify-between rounded-card bg-card p-4 shadow-card hover:shadow-raise"
            >
              <span className="text-sm font-medium">{STATUS_LABEL[status]}</span>
              <span className="text-xs text-ink-3">{count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}