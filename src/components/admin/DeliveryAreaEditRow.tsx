"use client";

import { useActionState, useState } from "react";
import { updateDeliveryAreaAction } from "@/app/actions/admin/delivery-areas";
import type { DeliveryAreaUpdateResult } from "@/lib/admin-delivery-areas";

/*
  One delivery area, editable in place.

  Controlled inputs, so a rejected save keeps what was typed.

  The checkbox is the field worth care. An unticked checkbox sends nothing at
  all, so the parser reads it by absence — `formData.get("isActive") === "on"`.
  There is deliberately no hidden companion input before it: with both present
  `.get()` returns the first one, which would be the hidden "off", and turning
  a county off would silently turn it straight back on. That combination is the
  single most common way this particular control breaks.
*/

type Props = {
  area: {
    id: string;
    county: string;
    baseFee: number;
    freeDeliveryThreshold: number | null;
    etaDaysMin: number;
    etaDaysMax: number;
    isActive: boolean;
  };
};

export function DeliveryAreaEditRow({ area }: Props) {
  const [baseFee, setBaseFee] = useState(String(area.baseFee));
  const [threshold, setThreshold] = useState(
    area.freeDeliveryThreshold === null ? "" : String(area.freeDeliveryThreshold),
  );
  const [etaMin, setEtaMin] = useState(String(area.etaDaysMin));
  const [etaMax, setEtaMax] = useState(String(area.etaDaysMax));
  const [isActive, setIsActive] = useState(area.isActive);

  const [state, formAction, pending] = useActionState<
    DeliveryAreaUpdateResult | null,
    FormData
  >(async (_previous, formData) => updateDeliveryAreaAction(area.id, formData), null);

  const errors = state && !state.ok ? state.errors : {};
  const message = state ? state.message : null;

  const field =
    "h-11 w-full rounded-control border border-hairline bg-card px-3 text-base text-ink";
  const invalid = "border-sale";

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label
            htmlFor={`fee-${area.id}`}
            className="mb-1 block text-xs font-medium text-ink-3"
          >
            Delivery fee (KSh)
          </label>
          <input
            id={`fee-${area.id}`}
            name="baseFee"
            inputMode="decimal"
            value={baseFee}
            onChange={(event) => setBaseFee(event.target.value)}
            className={`${field} ${errors.baseFee ? invalid : ""}`}
          />
          {errors.baseFee && (
            <p role="alert" className="mt-1 text-sm font-medium text-sale">
              {errors.baseFee}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor={`threshold-${area.id}`}
            className="mb-1 block text-xs font-medium text-ink-3"
          >
            Free above (KSh)
          </label>
          <input
            id={`threshold-${area.id}`}
            name="freeDeliveryThreshold"
            inputMode="decimal"
            placeholder="None"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            className={`${field} ${errors.freeDeliveryThreshold ? invalid : ""}`}
          />
          <p className="mt-1 text-xs text-ink-3">Leave empty for no threshold.</p>
          {errors.freeDeliveryThreshold && (
            <p role="alert" className="mt-1 text-sm font-medium text-sale">
              {errors.freeDeliveryThreshold}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor={`eta-min-${area.id}`}
            className="mb-1 block text-xs font-medium text-ink-3"
          >
            Fastest (days)
          </label>
          <input
            id={`eta-min-${area.id}`}
            name="etaDaysMin"
            inputMode="numeric"
            value={etaMin}
            onChange={(event) => setEtaMin(event.target.value)}
            className={`${field} ${errors.etaDaysMin ? invalid : ""}`}
          />
          {errors.etaDaysMin && (
            <p role="alert" className="mt-1 text-sm font-medium text-sale">
              {errors.etaDaysMin}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor={`eta-max-${area.id}`}
            className="mb-1 block text-xs font-medium text-ink-3"
          >
            Slowest (days)
          </label>
          <input
            id={`eta-max-${area.id}`}
            name="etaDaysMax"
            inputMode="numeric"
            value={etaMax}
            onChange={(event) => setEtaMax(event.target.value)}
            className={`${field} ${errors.etaDaysMax ? invalid : ""}`}
          />
          {errors.etaDaysMax && (
            <p role="alert" className="mt-1 text-sm font-medium text-sale">
              {errors.etaDaysMax}
            </p>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="h-4 w-4"
        />
        Shoppers can choose this county
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-control bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-2 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {!area.isActive && (
          <span className="text-xs font-semibold text-sale">
            Currently off — this county cannot be chosen at checkout.
          </span>
        )}
      </div>

      {message && (
        <p
          role={state && !state.ok ? "alert" : "status"}
          className={`text-sm font-medium ${
            state && !state.ok ? "text-sale" : "text-ink-2"
          }`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
