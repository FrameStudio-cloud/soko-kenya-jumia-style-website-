import Link from "next/link";
import type { CategoryRow } from "@/lib/queries";

export function SiteHeader({
  cartCount,
  query,
  categories,
}: {
  cartCount: number;
  query?: string;
  categories: CategoryRow[];
}) {
  return (
    <header className="sticky top-0 z-30 shadow-card">
      {/* Brand bar. Dark ink on the fill is 7.15:1, so the wordmark is
          legible without inverting to white, which would drop to 2.1:1. */}
      <div className="bg-brand-fill">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-2.5 sm:gap-6 sm:px-6">
          <Link
            href="/"
            className="min-w-0 shrink text-base font-bold tracking-tight text-ink sm:shrink-0 sm:text-xl"
          >
            Soko<span className="font-normal">Kenya</span>
          </Link>

          {/* Search. At 44px min it clears the HIG touch-target floor and
              iOS will not zoom it on focus, since font-size is 16px. */}
          <form
            action="/search"
            role="search"
            className="flex flex-1 items-center"
          >
            <label htmlFor="site-search" className="sr-only">
              Search products
            </label>
            <input
              id="site-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search for products, brands and sellers"
              className="h-11 w-full rounded-l-control border-0 bg-card px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
            <button
              type="submit"
              className="flex h-11 shrink-0 items-center gap-2 rounded-r-control bg-ink px-3 text-sm font-semibold text-white hover:bg-ink-2 sm:px-4"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <span className="hidden sm:inline">Search</span>
            </button>
          </form>

          {/*
            Settings beside the cart, not only in the footer. It sets the
            default address that pre-fills checkout, so a shopper who wants to
            change where things are delivered needs to find it without having
            to know the URL.

            It carries an explicit accessible name because the visible label is
            `hidden` under sm — with the label hidden from the accessibility
            tree, an icon-only link announces as nothing at all.
          */}
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex shrink-0 items-center gap-2 rounded-control px-1.5 py-2 text-sm font-semibold text-ink hover:bg-black/10 sm:px-2"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="hidden sm:inline">Settings</span>
          </Link>

          {/*
            Same accessible-name reason as the link above: the "Cart" label is
            display:none under sm, so without this the link announces as empty
            whenever the cart is empty and the badge is absent. The count is in
            the name because it is the one fact worth knowing before pressing.
          */}
          <Link
            href="/cart"
            aria-label={cartCount > 0 ? `Cart, ${cartCount} items` : "Cart"}
            className="relative flex shrink-0 items-center gap-2 rounded-control px-1.5 py-2 text-sm font-semibold text-ink hover:bg-black/10 sm:px-2"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 4h2l2.5 12h10L20 7H6" />
              <circle cx="10" cy="20" r="1.5" />
              <circle cx="17" cy="20" r="1.5" />
            </svg>
            <span className="hidden sm:inline">Cart</span>
            {cartCount > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-pill bg-ink px-1 text-2xs font-bold text-white"
                aria-label={`${cartCount} items in cart`}
              >
                {cartCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/*
        Category rail. A horizontally scrollable list on phones rather than a
        dropdown: Jumia's two-level menu is unusable with a thumb, and a rail
        makes the categories visible at the width people actually browse.
      */}
      <nav aria-label="Product categories" className="border-b border-hairline bg-card">
        <ul className="no-scrollbar mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 sm:px-6">
          {categories.map((category) => (
            <li key={category.id}>
              <Link
                href={`/category/${category.slug}`}
                className="flex h-11 items-center whitespace-nowrap rounded-control px-3 text-sm font-medium text-ink-2 hover:bg-brand-tint hover:text-brand"
              >
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

export function CategoryRail({ categories: items }: { categories: CategoryRow[] }) {
  return (
    <nav aria-label="Categories" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((category) => (
        <Link
          key={category.slug}
          href={`/category/${category.slug}`}
          className="flex items-center justify-between rounded-card bg-card p-4 shadow-card transition-shadow hover:shadow-raise"
        >
          <span className="font-medium">{category.name}</span>
          <span className="text-xs text-ink-3">{category.productCount} items</span>
        </Link>
      ))}
    </nav>
  );
}