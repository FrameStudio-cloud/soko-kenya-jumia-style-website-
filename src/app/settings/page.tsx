import type { Metadata } from "next";
import Link from "next/link";
import { SettingsForm } from "@/components/SettingsForm";
import { quoteDelivery } from "@/lib/checkout";
import { readPreferences, hasSavedAddress } from "@/lib/preferences";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings — SokoKenya" };

export default async function SettingsPage() {
  const [preferences, quote] = await Promise.all([
    readPreferences(),
    quoteDelivery("Nairobi"),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-ink-2">
          Saved on this device
          {hasSavedAddress(preferences) && ", used to speed up checkout"}.
        </p>
      </div>

      {/*
        The honest framing, on the page rather than only in a comment.

        This is not an account page, and a shopper who saves an address here
        and then signs in somewhere else would reasonably expect the address to
        follow them. Saying "this device" prevents that expectation being set —
        and makes the absence of accounts an obvious next step rather than a
        silent gap.
      */}
      <p className="rounded-control border-l-4 border-l-info bg-info-tint px-4 py-3 text-sm text-ink">
        You don&apos;t have an account yet, so these settings are stored in this
        browser only. They will not follow you to another device, and clearing
        your browser data will remove them.
      </p>

      <SettingsForm preferences={preferences} counties={quote.availableCounties} />

      <nav aria-label="Related pages" className="border-t border-hairline-2 pt-6">
        <h2 className="text-sm font-semibold text-ink-2">Elsewhere</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <li>
            <Link
              href="/cart"
              className="flex min-h-11 items-center justify-between rounded-card bg-card px-4 py-3 text-sm font-medium shadow-card hover:bg-canvas"
            >
              Your cart
              <span aria-hidden="true" className="text-ink-3">
                &rarr;
              </span>
            </Link>
          </li>
          <li>
            <Link
              href="/search"
              className="flex min-h-11 items-center justify-between rounded-card bg-card px-4 py-3 text-sm font-medium shadow-card hover:bg-canvas"
            >
              Browse products
              <span aria-hidden="true" className="text-ink-3">
                &rarr;
              </span>
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}