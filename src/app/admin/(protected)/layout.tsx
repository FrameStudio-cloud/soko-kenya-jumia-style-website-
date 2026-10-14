import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { logoutAction } from "@/app/actions/admin/auth";

/*
  The guard for every admin page.

  A route group, not middleware. `src/app/admin/login` sits outside it and so
  does not guard itself into a redirect loop; everything else in /admin is a
  child of this layout and cannot render without passing requireAdmin().

  This is not sufficient on its own and is not meant to be. A page guard stops
  a stranger loading a screen; it does nothing about POSTing to the server
  action behind it. Every action calls requireAdminAction() too, and
  scripts/test-admin-auth.ts asserts that both refuse an unauthenticated caller.
*/
const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/sellers", label: "Sellers" },
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/delivery-areas", label: "Delivery" },
] as const;

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-hairline-2 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Admin
          </p>
          <nav aria-label="Admin sections">
            <ul className="mt-1 flex flex-wrap gap-1">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex h-11 items-center rounded-control px-3 text-sm font-medium text-ink-2 hover:bg-canvas"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <form action={logoutAction}>
          <button
            type="submit"
            className="h-11 rounded-control border border-hairline px-4 text-sm font-semibold text-ink hover:bg-canvas"
          >
            Sign out
          </button>
        </form>
      </div>

      {children}
    </div>
  );
}