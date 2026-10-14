"use client";

import { useState, useTransition } from "react";
import { submitCheckoutAction } from "@/app/actions/checkout";
import { writeLastOrder } from "@/lib/order-badge";
import type { CheckoutInput } from "@/lib/checkout";

/*
  Checkout form.

  Feedback appears in place. A shopper who mistypes a phone number should see
  the problem next to the field they mistyped, not in a modal or a banner at
  the top they have to scroll back to find. Errors are announced too: the
  summary is an alert region, so a screen-reader user hears that submission
  failed without needing to go hunting for it.

  The persistent "Order sent / not sent" badge is rendered by
  OrderResultBadge in the page shell, not here — it has to outlive this form,
  and a failure leaves the shopper on this very page with no redirect to carry
  it to.
*/
export function CheckoutForm({
  counties,
  itemCount,
  savedAddress,
}: {
  counties: Array<{ county: string; fee: number }>;
  itemCount: number;
  /** Pre-fill from settings, when the shopper saved one. */
  savedAddress?: {
    recipientName: string;
    phone: string;
    county: string;
    town: string;
    street: string;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const initialCounty =
    savedAddress?.county && counties.some((c) => c.county === savedAddress.county)
      ? savedAddress.county
      : (counties[0]?.county ?? "");

  const [county, setCounty] = useState(initialCounty);

  function handleSubmit(formData: FormData) {
    const input: CheckoutInput = {
      recipientName: String(formData.get("recipientName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      county: String(formData.get("county") ?? ""),
      town: String(formData.get("town") ?? ""),
      street: String(formData.get("street") ?? "") || undefined,
      notes: String(formData.get("notes") ?? "") || undefined,
      paymentMethod: "cod",
    };

    startTransition(async () => {
      const result = await submitCheckoutAction(input);

      /*
        Persisting the badge happens HERE, in the client, not in the action. A
        server action runs on the server and cannot reach localStorage; marking
        it "use client" to try pulled next/headers into the browser bundle and
        500'd the page.

        On success the action redirects before returning, so this only runs for
        failures — which is exactly when the badge matters, because there is no
        confirmation page to show it on.
      */
      if (!result.ok) {
        writeLastOrder(result.badge);
        setError(result.message);
        setFieldErrors(result.fields ?? {});
      }
    });
  }

  const field = (name: string) => {
    const message = fieldErrors[name];
    if (!message) return null;
    return (
      <p id={`${name}-error`} className="mt-1.5 text-sm font-medium text-sale">
        {message}
      </p>
    );
  };

  const inputClass = (name: string) =>
    [
      "h-12 w-full rounded-control border bg-card px-3 text-base text-ink",
      "placeholder:text-ink-3",
      // aria-invalid + a red border, but never colour alone: the message text
      // and aria-describedby carry the meaning for everyone.
      fieldErrors[name]
        ? "border-sale"
        : "border-hairline focus:border-brand",
    ].join(" ");

  return (
    <form action={handleSubmit} className="space-y-5" noValidate={false}>
      {error && (
        <div
          role="alert"
          className="rounded-control border-l-4 border-l-sale bg-sale-tint px-4 py-3"
        >
          <p className="text-sm font-medium text-ink">{error}</p>
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">Where should this go?</legend>

        <div>
          <label htmlFor="recipientName" className="mb-1.5 block text-sm font-medium">
            Recipient name
          </label>
          <input
            id="recipientName"
            name="recipientName"
            required
            autoComplete="name"
            aria-describedby={fieldErrors.recipientName ? "recipientName-error" : undefined}
            aria-invalid={fieldErrors.recipientName ? true : undefined}
            className={inputClass("recipientName")}
            placeholder="e.g. Wanjiku Kamau"
            defaultValue={savedAddress?.recipientName}
          />
          {field("recipientName")}
        </div>

        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium">
            Phone number
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            required
            autoComplete="tel"
            placeholder="0712 345 678"
            aria-describedby={
              fieldErrors.phone ? "phone-error" : "phone-hint"
            }
            aria-invalid={fieldErrors.phone ? true : undefined}
            className={inputClass("phone")}
            defaultValue={savedAddress?.phone}
          />
          {/* The courier calls this number. Saying so sets expectations. */}
          <p id="phone-hint" className="mt-1.5 text-xs text-ink-2">
            The rider will call this number on delivery.
          </p>
          {field("phone")}
        </div>

        <div>
          <label htmlFor="county" className="mb-1.5 block text-sm font-medium">
            County
          </label>
          <select
            id="county"
            name="county"
            required
            value={county}
            onChange={(e) => setCounty(e.target.value)}
            aria-describedby={fieldErrors.county ? "county-error" : undefined}
            aria-invalid={fieldErrors.county ? true : undefined}
            className={inputClass("county")}
          >
            <option value="" disabled>
              Choose a county
            </option>
            {counties.map((c) => (
              <option key={c.county} value={c.county}>
                {c.county} — KSh {c.fee.toLocaleString("en-KE")} delivery
              </option>
            ))}
          </select>
          {field("county")}
        </div>

        <div>
          <label htmlFor="town" className="mb-1.5 block text-sm font-medium">
            Town or estate
          </label>
          <input
            id="town"
            name="town"
            required
            autoComplete="address-level2"
            className={inputClass("town")}
            placeholder="e.g. Westlands"
            defaultValue={savedAddress?.town}
          />
          {field("town")}
        </div>

        <div>
          <label htmlFor="street" className="mb-1.5 block text-sm font-medium">
            Street or building <span className="font-normal text-ink-2">(optional)</span>
          </label>
          <input
            id="street"
            name="street"
            autoComplete="address-line1"
            className={inputClass("street")}
            placeholder="e.g. Karen Blk 4, house 12"
            defaultValue={savedAddress?.street}
          />
        </div>

        <div>
          <label htmlFor="notes" className="mb-1.5 block text-sm font-medium">
            Delivery notes <span className="font-normal text-ink-2">(optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="w-full rounded-control border border-hairline bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-3 focus:border-brand"
            placeholder="Landmark, gate colour, when to call"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t border-hairline-2 pt-5">
        <legend className="text-lg font-semibold">Payment</legend>

        <label className="flex cursor-pointer items-start gap-3 rounded-card border border-brand bg-brand-tint p-4">
          <input
            type="radio"
            name="paymentMethod"
            value="cod"
            defaultChecked
            className="mt-0.5 h-5 w-5 accent-[#c2410c]"
          />
          <span>
            <span className="block font-semibold">Cash on delivery</span>
            <span className="mt-0.5 block text-sm text-ink-2">
              Pay the rider when your order arrives. M-Pesa payment arrives in a
              later phase.
            </span>
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-control bg-brand text-base font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? "Placing your order…"
          : `Place order · ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
      </button>

      <p className="text-center text-xs text-ink-3">
        Stock is held for 30 minutes. Placing your order takes it off sale.
      </p>
    </form>
  );
}
