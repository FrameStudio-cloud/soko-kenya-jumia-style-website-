import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminOrderDetail, STATUS_LABEL } from "@/lib/admin-orders";
import { OrderStatusControls } from "@/components/admin/OrderStatusControls";
import { RevealDelivery } from "@/components/admin/RevealDelivery";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const detail = await getAdminOrderDetail(reference);

  // Unknown reference. notFound() rather than a blank page — inside the admin
  // guard, so an unauthenticated caller still cannot probe for references.
  if (!detail) notFound();

  const { order, delivery, items, history } = detail;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/orders" className="text-sm text-ink-2 hover:text-brand">
            ← Orders
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{order.reference}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {order.sellerName} ·{" "}
            {new Date(order.createdAt).toLocaleString("en-KE", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <span className="rounded-sm bg-brand-tint px-2 py-1 text-xs font-medium text-brand">
          {STATUS_LABEL[order.status]}
        </span>
      </div>

      <section className="rounded-card bg-card p-5 shadow-card">
        <h2 className="text-lg font-semibold">Change status</h2>
        <div className="mt-3">
          <OrderStatusControls orderId={order.id} status={order.status} />
        </div>
      </section>

      <section className="rounded-card bg-card p-5 shadow-card">
        <h2 className="text-lg font-semibold">Delivery</h2>
        <p className="mt-1 mb-4 text-sm text-ink-2">
          Masked until revealed. An operator needs the address to hand a parcel
          to a rider; the rest of the business does not need it on every screen.
        </p>
        <RevealDelivery
          orderId={order.id}
          reference={order.reference}
          recipientName={delivery.recipientName}
          town={delivery.town}
          street={delivery.street}
          phone={delivery.phone}
          hasPhone={delivery.hasPhone}
        />
        {delivery.notes && (
          <p className="mt-4 border-t border-hairline-2 pt-4 text-sm">
            <span className="text-ink-3">Delivery notes: </span>
            {delivery.notes}
          </p>
        )}
      </section>

      <section className="overflow-x-auto rounded-card bg-card shadow-card">
        <h2 className="px-4 pt-4 text-lg font-semibold">Items</h2>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">Items in this order</caption>
          <thead className="border-b border-hairline-2 text-xs uppercase tracking-wide text-ink-3">
            <tr>
              <th scope="col" className="px-4 py-3">Product</th>
              <th scope="col" className="px-4 py-3 text-right">Unit</th>
              <th scope="col" className="px-4 py-3 text-right">Qty</th>
              <th scope="col" className="px-4 py-3 text-right">Line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-2">
            {items.map((item) => (
              <tr key={item.productId}>
                <td className="px-4 py-3">{item.titleSnapshot}</td>
                <td className="px-4 py-3 text-right">{formatPrice(item.unitPrice)}</td>
                <td className="px-4 py-3 text-right">{item.quantity}</td>
                <td className="px-4 py-3 text-right font-semibold">
                  {formatPrice(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-card bg-card p-5 shadow-card">
        <h2 className="text-lg font-semibold">History</h2>
        <ol className="mt-3 space-y-3">
          {history.map((entry, index) => (
            <li key={index} className="flex flex-wrap gap-x-2 text-sm">
              <span className="text-ink-3">
                {new Date(entry.createdAt).toLocaleString("en-KE", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              <span>
                {entry.fromStatus ? `${entry.fromStatus} → ` : ""}
                <strong>{entry.toStatus}</strong>
              </span>
              <span className="text-ink-3">by {entry.changedBy ?? "unknown"}</span>
              {entry.note && <span className="text-ink-2">— {entry.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}