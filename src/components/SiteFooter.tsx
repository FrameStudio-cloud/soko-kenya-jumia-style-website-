import Link from "next/link";
import type { CategoryRow } from "@/lib/queries";

/*
  Footer.

  Every link resolves to a route that exists TODAY: /category/[slug], /search,
  /cart, /settings. There is no /help, /about, /contact or /sell — those pages
  are not built, and a footer full of links that 404 is worse than a short
  honest one. Add a link here in the same change that ships the page.

  Deliberately no phase or prototype status. This footer used to carry a
  paragraph saying checkout was not wired and M-Pesa was not implemented — both
  untrue, and exactly the kind of copy that rots silently once written, because
  nothing fails when it goes stale. What the site does not do yet belongs where
  it matters, beside the thing it describes: the checkout page says cash on
  delivery, next to the button that places the order.
*/

/*
  Verified against SORT_OPTIONS in src/lib/queries.ts. A typo in a sort value
  does NOT 404 — search silently falls back to best match, so a wrong link here
  looks fine and returns the wrong products. Double-check these by hand.
*/
const POPULAR = [
  { href: "/search?sort=discount", label: "Biggest discounts" },
  { href: "/search?sort=newest", label: "Newest arrivals" },
  { href: "/search?sort=rating_desc", label: "Top rated" },
  { href: "/search?sort=price_asc", label: "Lowest prices" },
];

const QUICK_LINKS = [
  { href: "/search", label: "Search all products" },
  { href: "/cart", label: "Your cart" },
  { href: "/settings", label: "Delivery settings" },
];

export function SiteFooter({ categories }: { categories: CategoryRow[] }) {
  return (
    <footer className="mt-12 border-t border-hairline bg-card">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          {/* Same wordmark treatment as the header, so the two ends of the
              page agree. */}
          <p className="text-xl font-bold tracking-tight text-ink">
            Soko<span className="font-normal">Kenya</span>
          </p>
          <p className="mt-3 max-w-xs text-sm text-ink-2">
            Buy and sell across Kenya from verified sellers, with the delivery
            estimate and the full price shown before you commit.
          </p>
        </div>

        <nav aria-labelledby="footer-shop">
          <h2 id="footer-shop" className="text-sm font-semibold text-ink">
            Shop by category
          </h2>
          <ul className="mt-2">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/category/${category.slug}`}
                  className="inline-flex items-center py-1.5 text-sm text-ink-2 hover:text-brand"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-popular">
          <h2 id="footer-popular" className="text-sm font-semibold text-ink">
            Popular
          </h2>
          <ul className="mt-2">
            {POPULAR.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex items-center py-1.5 text-sm text-ink-2 hover:text-brand"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-quick">
          <h2 id="footer-quick" className="text-sm font-semibold text-ink">
            Quick links
          </h2>
          <ul className="mt-2">
            {QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex items-center py-1.5 text-sm text-ink-2 hover:text-brand"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-hairline-2">
        {/*
          py-1.5 lands these links at ~32px, below the 44px the header holds its
          own nav to. That is a deliberate trade, not an oversight: the header
          rail is the primary navigation and gets thumb traffic one-handed,
          while these are stacked, generously spaced and secondary. Eight
          categories at 44px each turn the phone footer into a scroll.
        */}
        <div className="mx-auto flex max-w-[1400px] flex-col gap-1 px-4 py-4 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {/* force-dynamic on the layout means this re-reads per request, so
              the year never goes stale the way a hardcoded one does. */}
          <p>© {new Date().getFullYear()} SokoKenya. Nairobi, Kenya.</p>
          <p>Cash on delivery — you pay when your order arrives.</p>
        </div>
      </div>
    </footer>
  );
}
