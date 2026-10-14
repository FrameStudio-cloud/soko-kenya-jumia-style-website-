import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderByReference } from "@/lib/checkout";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  const { reference } = await params;
  const order = await getOrderByReference(reference);
  return { title: order ? `Order ${order.reference} — SokoKenya` : "Order not found" };
}

/*
  Order confirmation.

  Shows EVERY reference placed by one checkout, not just the one in the URL.
  A mixed-seller basket produces several orders and the shopper paid once;
  hiding the others behind a query parameter would make it look like the rest
  went missing.
*/
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ also?: string }>;
}) {
  const { reference } = await params;
  const { also } = await searchParams;

  const order = await getOrderByReference(reference);
  if (!order) notFound();

  const siblings = also
    ? also
        .split(",")
        .filter((r) => r && r !== reference)
        .map((r) => ({ reference: r }))
    : [];

  const statusLabel: Record<string, string> = {
    pending_payment: "Awaiting payment",
    confirmed: "Confirmed — the seller has it",
    dispatched: "On the way",
    delivered: "Delivered",
    cancelled: "Cancelled",
    refunded: "Refunded",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-card bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {order.status === "cancelled" ? "Order cancelled" : "Order placed"}
            </h1>
            <p className="mt-1 text-sm text-ink-2">
              {siblings.length > 0
                ? `${siblings.length + 1} orders were created — one per seller.`
                : "The seller has your order."}
            </p>
          </div>
          {/*
            The reference is the durable record: a shopper reads it out to the
            seller, and it survives the session. Large enough to read off a
            screen, in a monospace face so the characters cannot be confused.
          */}
          <div className="rounded-control bg-canvas px-4 py-2.5 text-right">
            <p className="text-xs text-ink-2">Order reference</p>
            <p className="font-mono text-lg font-bold tracking-wide">
              {order.reference}
            </p>
          </div>
        </div>

        <p className="mt-4 inline-flex rounded-control bg-info-tint px-3 py-1.5 text-sm font-medium text-ink">
          {statusLabel[order.status] ?? order.status}
        </p>
      </section>

      <section className="rounded-card bg-card p-6 shadow-card">
        <h2 className="text-lg font-semibold">Delivering to</h2>
        <address className="mt-2 text-base not-italic leading-relaxed">
          <p className="font-medium">{order.address.recipientName}</p>
          <p>{order.sellerName}</p>
          <p className="text-ink-2">
            {order.address.town}
            {order.address.street ? `, ${order.address.street}` : ""}
          </p>
          <p className="text-ink-2">{order.county}</p>
          {order.phone && <p className="text-ink-2">{order.phone}</p>}
        </address>
      </section>

      <section className="rounded-card bg-card p-6 shadow-card">
        <h2 className="text-lg font-semibold">Items</h2>
        <ul className="mt-3 divide-y divide-hairline-2">
          {order.items.map((item) => (
            <li key={item.title} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <Link
                  href={`/product/${item.slug}`}
                  className="text-sm hover:text-brand hover:underline"
                >
                  {item.title}
                </Link>
                <p className="mt-0.5 text-xs text-ink-2">
                  {item.quantity} &times; {formatPrice(item.unitPrice)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold">
                {formatPrice(item.lineTotal)}
              </p>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t border-hairline-2 pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-2">Subtotal</dt>
            <dd className="font-medium">{formatPrice(order.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-2">Delivery</dt>
            <dd className="font-medium">
              {order.deliveryTotal === 0 ? (
                <span className="font-semibold text-discount">Free</span>
              ) : (
                formatPrice(order.deliveryTotal)
              )}
            </dd>
          </div>
          <div className="flex justify-between border-t border-hairline-2 pt-2">
            <dt className="font-semibold">Total</dt>
            <dd className="text-lg font-bold">{formatPrice(order.grandTotal)}</dd>
          </div>
        </dl>

        {/*
          Cash on delivery is stated as what it is: money has NOT been taken.
          A generic "thank you for your order" on a COD order reads as
          confirmation that payment happened.
        */}
        <p className="mt-4 rounded-control bg-brand-tint px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Cash on delivery.</span> Have{" "}
          {formatPrice(order.grandTotal)} ready for the rider. Nothing has been
          charged yet.
        </p>
      </section>

      {siblings.length > 0 && (
        <section className="rounded-card border-l-4 border-l-info bg-info-tint p-5">
          <h2 className="font-semibold">Other orders from this checkout</h2>
          <ul className="mt-2 space-y-1.5">
            {siblings.map((s) => (
              <li key={s.reference}>
                <Link
                  href={`/order/${s.reference}`}
                  className="font-mono text-sm font-medium underline underline-offset-2"
                >
                  {s.reference}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-2">
            Each seller receives and ships their own order.
          </p>
        </section>
      )}

      {order.history.length > 0 && (
        <section className="rounded-card bg-card p-6 shadow-card">
          <h2 className="text-lg font-semibold">Progress</h2>
          <ol className="mt-3 space-y-3">
            {order.history.map((entry, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-pill bg-brand"
                />
                <div>
                  <p className="font-medium">
                    {statusLabel[entry.toStatus] ?? entry.toStatus}
                  </p>
                  <p className="text-xs text-ink-2">
                    {new Date(entry.createdAt).toLocaleString("en-KE", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-control bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          Keep shopping
        </Link>
        <Link
          href="/search"
          className="inline-flex h-11 items-center rounded-control border border-hairline px-6 text-sm font-semibold text-ink hover:bg-brand-tint"
        >
          Search more products
        </Link>
      </div>
    </div>
  );
}
