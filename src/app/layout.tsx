import type { Metadata } from "next";
import { getCartCount } from "@/lib/cart";
import { getCategories } from "@/lib/queries";
import { SiteHeader } from "@/components/Header";
import { SiteFooter } from "@/components/SiteFooter";
import { OrderResultBadge } from "@/components/OrderResultBadge";
import "./globals.css";

export const metadata: Metadata = {
  title: "SokoKenya — buy and sell across Kenya",
  description:
    "A marketplace for Kenyan sellers and buyers. Fast delivery, verified sellers, fair prices.",
};

/*
  The category rail lives in the header, so the layout fetches categories on
  every route, and the cart badge needs a count that changes per shopper.

  Sequential rather than Promise.all, and deliberately: if the cart query
  fails, a shopper still gets a page with working navigation instead of an
  error page. Coupling a cosmetic badge to page rendering is the wrong
  dependency direction.

  `dynamic` is required. Reading cookies() opts the render out of the static
  cache, so without this Next would try to prerender a per-shopper badge into
  a shared HTML file — one shopper's cart count served to everyone.
*/
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const categories = await getCategories();
  const cartCount = await getCartCount().catch(() => 0);

  return (
    <html lang="en-KE">
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:h-11 focus:rounded-control focus:bg-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to main content
        </a>

        <SiteHeader cartCount={cartCount} categories={categories} />

        <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
          {/*
            The last checkout result, persisted across pages.

            It lives here rather than on /checkout because a FAILED checkout
            never navigates — the shopper stays on the form. Putting the badge
            on the success page would mean failures are only ever visible as a
            transient inline error, which is the case where a shopper most needs
            to know the order did NOT go through.
          */}
          <div className="mb-6">
            <OrderResultBadge />
          </div>
          {children}
        </main>

        {/*
          The categories are already in memory for the header rail, so the
          footer reuses that fetch rather than querying again. A second read
          for links that will never change mid-request is a wasted round trip.
        */}
        <SiteFooter categories={categories} />
      </body>
    </html>
  );
}
