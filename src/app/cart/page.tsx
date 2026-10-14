import type { Metadata } from "next";
import Link from "next/link";
import { CartItemRow } from "@/components/CartItemRow";
import { MAX_QUANTITY_PER_LINE, getCartView } from "@/lib/cart";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cart — SokoKenya" };

export default async function CartPage() {
  const cart = await getCartView();

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">Your cart</h1>

        {/*
          An empty cart is a normal state with a next action, not an error.
          Two buttons rather than one: browsing is the obvious next step,
          checking out a wishlist is the other thing people want.
        */}
        <div className="mt-4 rounded-card bg-card p-10 text-center shadow-card">
          <h2 className="text-lg font-semibold">Your cart is empty</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">
            Nothing here yet. Items you add are held for you for 30 minutes, so
            nothing sells out while you decide.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="inline-flex h-11 items-center rounded-control bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              Browse products
            </Link>
            <Link
              href="/search"
              className="inline-flex h-11 items-center rounded-control border border-hairline px-6 text-sm font-semibold text-ink hover:bg-brand-tint"
            >
              Search instead
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <h1 className="text-2xl font-bold">Your cart</h1>
        <p className="mt-1 text-sm text-ink-2">
          {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"} from{" "}
          {cart.sellers.length}{" "}
          {cart.sellers.length === 1 ? "seller" : "sellers"}
        </p>

        {/*
          Stated, not hidden. A cart quietly containing an unbuyable item is
          the classic marketplace bug, and it surfaces at checkout as a
          failure the shopper did not cause.
        */}
        {cart.unavailableCount > 0 && (
          <p
            role="status"
            className="mt-4 rounded-control border-l-4 border-l-alert bg-alert-tint px-4 py-3 text-sm text-ink"
          >
            {cart.unavailableCount === 1
              ? "One item is no longer available in that quantity."
              : `${cart.unavailableCount} items are no longer available in those quantities.`}{" "}
            Lower the quantity or remove them to continue.
          </p>
        )}

        {cart.sellers.length > 1 && (
          <p className="mt-4 rounded-control bg-info-tint px-4 py-3 text-sm text-ink">
            Your cart has items from {cart.sellers.length} sellers. At checkout
            this becomes {cart.sellers.length} separate orders — one payment,
            one delivery per seller.
          </p>
        )}

        <ul className="mt-4 rounded-card bg-card px-4 shadow-card">
          {cart.items.map((item) => (
            <CartItemRow
              key={item.productId}
              item={item}
              maxQuantity={MAX_QUANTITY_PER_LINE}
            />
          ))}
        </ul>
      </div>

      {/* Summary. Sticky on desktop so it stays visible while scrolling. */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-card bg-card p-5 shadow-card">
          <h2 className="text-lg font-semibold">Order summary</h2>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-2">Subtotal</dt>
              <dd className="font-semibold">{formatPrice(cart.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-2">Delivery</dt>
              <dd className="text-ink-2">Calculated at checkout</dd>
            </div>
            <div className="flex justify-between border-t border-hairline-2 pt-2">
              <dt className="font-semibold">Total</dt>
              <dd className="text-lg font-bold">{formatPrice(cart.subtotal)}</dd>
            </div>
          </dl>

          <p className="mt-2 text-xs text-ink-3">
            Delivery depends on your county and is worked out from your address
            at checkout.
          </p>

          {/*
            Now real. Checkout converts the cart to orders and takes stock off
            sale in one transaction, so this is no longer a placeholder.
          */}
          <Link
            href="/checkout"
            className="mt-5 flex h-12 w-full items-center justify-center rounded-control bg-brand text-base font-semibold text-white hover:bg-brand-hover"
          >
            Proceed to checkout
          </Link>

          <p className="mt-3 text-center text-xs text-ink-3">
            Cash on delivery. Nothing is charged now.
          </p>
        </div>
      </aside>
    </div>
  );
}
