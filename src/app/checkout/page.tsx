import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/CheckoutForm";
import { getCartView } from "@/lib/cart";
import { quoteDelivery } from "@/lib/checkout";
import { readPreferences } from "@/lib/preferences";
import { formatPrice, imageUrl } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout — SokoKenya" };

export default async function CheckoutPage() {
  const cart = await getCartView();

  /*
    Redirect rather than render an empty checkout. An empty form with a dead
    Place-order button is a dead end; the cart is where the action is.
  */
  if (cart.items.length === 0) {
    redirect("/cart");
  }

  const preferences = await readPreferences();
  const quote = await quoteDelivery(preferences.county || "Nairobi");

  // Only pre-fill when the shopper actually saved a usable address.
  const savedAddress =
    preferences.county && preferences.recipientName
      ? {
          recipientName: preferences.recipientName,
          phone: preferences.phone,
          county: preferences.county,
          town: preferences.town,
          street: preferences.street,
        }
      : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <h1 className="text-2xl font-bold">Checkout</h1>
        <p className="mt-1 text-sm text-ink-2">
          {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"} from{" "}
          {cart.sellers.length}{" "}
          {cart.sellers.length === 1 ? "seller" : "sellers"}
        </p>

        <div className="mt-6 rounded-card bg-card p-5 shadow-card sm:p-6">
          <CheckoutForm
            counties={quote.availableCounties}
            itemCount={cart.itemCount}
            savedAddress={savedAddress}
          />
          {savedAddress && (
            <p className="mt-4 text-sm text-ink-2">
              Pre-filled from your{" "}
              <Link href="/settings" className="font-medium text-brand hover:underline">
                settings
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-card bg-card p-5 shadow-card">
          <h2 className="text-lg font-semibold">Order summary</h2>

          <ul className="mt-4 divide-y divide-hairline-2">
            {cart.items.map((item) => {
              const src = imageUrl(item.imageKey);
              return (
                <li key={item.productId} className="flex gap-3 py-3">
                  {/*
                    Empty alt, same reason as the cart row: the title sits
                    right beside this and would otherwise be announced twice.
                  */}
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      width={56}
                      height={56}
                      loading="lazy"
                      decoding="async"
                      className="h-14 w-14 shrink-0 rounded-control bg-canvas object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-control bg-canvas"
                    >
                      <span className="text-2xs uppercase text-ink-3">img</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="clamp-2 text-sm">{item.title}</p>
                    <p className="mt-0.5 text-xs text-ink-2">
                      {item.quantity} &times; {formatPrice(item.unitPrice)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold">
                    {formatPrice(item.lineTotal)}
                  </p>
                </li>
              );
            })}
          </ul>

          <dl className="mt-4 space-y-2 border-t border-hairline-2 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-2">Subtotal</dt>
              <dd className="font-semibold">{formatPrice(cart.subtotal)}</dd>
            </div>

            {/*
              Delivery cannot be totalled until a county is chosen, because
              free-delivery thresholds are per seller basket and differ by
              county. Saying "calculated at checkout" would be a loop — this IS
              checkout — so it states what it depends on instead.
            */}
            <div className="flex justify-between">
              <dt className="text-ink-2">Delivery</dt>
              <dd className="text-right text-ink-2">
                Depends on the county you choose
              </dd>
            </div>

            <div className="flex justify-between border-t border-hairline-2 pt-2">
              <dt className="font-semibold">Subtotal today</dt>
              <dd className="text-lg font-bold">{formatPrice(cart.subtotal)}</dd>
            </div>
          </dl>

          {/*
            Per-seller delivery is the thing most likely to surprise a shopper
            used to single-seller carts, so it is stated before they commit
            rather than revealed on the confirmation page.
          */}
          {cart.sellers.length > 1 && (
            <div className="mt-4 rounded-control bg-info-tint px-4 py-3">
              <p className="text-sm font-medium text-ink">
                Delivery is charged per seller
              </p>
              <ul className="mt-1.5 space-y-1 text-sm text-ink-2">
                {cart.sellers.map((s) => (
                  <li key={s.id} className="flex justify-between">
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 font-medium">
                      {formatPrice(
                        s.items.reduce((n, i) => n + i.lineTotal, 0),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 text-xs text-ink-3">
            Final total including delivery appears before you place the order.
          </p>
        </div>
      </aside>
    </div>
  );
}
