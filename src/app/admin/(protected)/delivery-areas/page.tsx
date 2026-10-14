import { listAdminDeliveryAreas } from "@/lib/admin-delivery-areas";
import { DeliveryAreaEditRow } from "@/components/admin/DeliveryAreaEditRow";

export const dynamic = "force-dynamic";

/*
  Delivery areas: fee, free-delivery threshold, estimate and the on/off flag.

  There is no create and no delete here either. The county name is the unique
  key and the value the checkout form matches against, so it is shown read-only
  rather than editable — renaming one would silently detach every order already
  addressed to it and turn a working county into `unsupported_county`.

  What the off switch does, with no extra query work anywhere: both delivery
  estimate reads and the lookup placeOrder() runs already filter `is_active`.
  Switching a county off therefore removes it from the estimate, unselects it
  at checkout, and refuses any order still addressed to it. That last part is
  the reason the banner above the list says what it says.
*/

function parseQuery(raw: string | undefined): string {
  return raw?.trim() ?? "";
}

export default async function AdminDeliveryAreasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = parseQuery((await searchParams).q);
  const needle = q.toLowerCase();

  const all = await listAdminDeliveryAreas();
  const areas = needle
    ? all.filter((area) => area.county.toLowerCase().includes(needle))
    : all;

  const activeCount = all.filter((area) => area.isActive).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Delivery areas</h1>
        <p className="mt-1 text-sm text-ink-2">
          {all.length} counties · {activeCount} deliverable
        </p>
      </div>

      <p className="rounded-card border-l-4 border-l-sale bg-alert-tint p-4 text-sm text-ink-2">
        Switching a county off takes it off the delivery estimate, removes it from the county
        picker at checkout, and <span className="font-semibold text-ink">refuses any order
        already addressed there</span>. Fees and thresholds can be changed at any time.
      </p>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="area-q" className="mb-1 block text-xs font-medium text-ink-3">
            Find a county
          </label>
          <input
            id="area-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Nairobi"
            className="h-11 w-56 rounded-control border border-hairline bg-card px-3 text-base text-ink"
          />
        </div>
        <button
          type="submit"
          className="h-11 rounded-control bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-2"
        >
          Apply
        </button>
        {q && (
          <a
            href="/admin/delivery-areas"
            className="flex h-11 items-center rounded-control px-3 text-sm font-medium text-ink-2 hover:bg-canvas"
          >
            Clear
          </a>
        )}
      </form>

      {areas.length === 0 ? (
        <p className="rounded-card border-l-4 border-l-alert bg-alert-tint p-5 text-sm text-ink-2">
          No county matches “{q}”.
        </p>
      ) : (
        <div className="space-y-4">
          {areas.map((area) => (
            <div key={area.id} className="rounded-card bg-card p-5 shadow-card">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold">{area.county}</h2>
                {area.isActive ? (
                  <span className="rounded-sm bg-ink px-2 py-0.5 text-xs font-semibold text-white">
                    Deliverable
                  </span>
                ) : (
                  <span className="rounded-sm bg-sale px-2 py-0.5 text-xs font-semibold text-white">
                    Off
                  </span>
                )}
              </div>
              <DeliveryAreaEditRow area={area} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
