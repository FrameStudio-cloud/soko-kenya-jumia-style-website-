"use client";

import { useState, useTransition } from "react";
import {
  resetPreferencesAction,
  savePreferencesAction,
} from "@/app/actions/settings";
import type { Preferences } from "@/lib/preferences";

/*
  Settings form.

  Uncontrolled inputs with a key derived from the saved preferences, so
  switching devices or resetting shows the new values. A controlled form with
  its own initial state would keep rendering the values that were loaded first.
*/

export function SettingsForm({
  preferences,
  counties,
}: {
  preferences: Preferences;
  counties: Array<{ county: string; fee: number }>;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Re-key the form when the saved preferences change, so a reset is visible.
  const formKey = JSON.stringify(preferences);

  const fieldError = (name: string) =>
    fieldErrors[name] ? (
      <p className="mt-1.5 text-sm font-medium text-sale">{fieldErrors[name]}</p>
    ) : null;

  const inputClass = (name: string) =>
    [
      "h-12 w-full rounded-control border bg-card px-3 text-base text-ink",
      "placeholder:text-ink-3",
      fieldErrors[name] ? "border-sale" : "border-hairline focus:border-brand",
    ].join(" ");

  function handleSubmit(formData: FormData) {
    const next: Preferences = {
      recipientName: String(formData.get("recipientName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      county: String(formData.get("county") ?? ""),
      town: String(formData.get("town") ?? ""),
      street: String(formData.get("street") ?? ""),
      showDeliveryEstimate: formData.get("showDeliveryEstimate") === "on",
      compactGrid: formData.get("compactGrid") === "on",
      confirmBeforeLeavingCart: formData.get("confirmBeforeLeavingCart") === "on",
    };

    startTransition(async () => {
      const result = await savePreferencesAction(next);
      setMessage({ ok: result.ok, text: result.message });
      setFieldErrors(result.fields ?? {});
    });
  }

  function handleReset() {
    startTransition(async () => {
      const result = await resetPreferencesAction();
      setMessage({ ok: result.ok, text: result.message });
      setFieldErrors({});
    });
  }

  return (
    <form key={formKey} action={handleSubmit} className="space-y-8">
      {message && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "rounded-control border-l-4 px-4 py-3",
            message.ok
              ? "border-l-discount bg-discount-tint"
              : "border-l-sale bg-sale-tint",
          ].join(" ")}
        >
          <p className="text-sm font-medium text-ink">{message.text}</p>
        </div>
      )}

      {/* ---------------------------------------------------- delivery */}
      <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
        <h2 className="text-lg font-semibold">Default delivery address</h2>
        <p className="mt-1 text-sm text-ink-2">
          Used to pre-fill the checkout form. Leave anything blank to skip it.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="recipientName" className="mb-1.5 block text-sm font-medium">
              Recipient name
            </label>
            <input
              id="recipientName"
              name="recipientName"
              autoComplete="name"
              aria-invalid={fieldErrors.recipientName ? true : undefined}
              aria-describedby={
                fieldErrors.recipientName ? "recipientName-error" : undefined
              }
              className={inputClass("recipientName")}
              placeholder="e.g. Wanjiku Kamau"
              defaultValue={preferences.recipientName}
            />
            {fieldError("recipientName")}
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
              autoComplete="tel"
              aria-invalid={fieldErrors.phone ? true : undefined}
              aria-describedby={fieldErrors.phone ? "phone-error" : "phone-hint"}
              className={inputClass("phone")}
              placeholder="0712 345 678"
              defaultValue={preferences.phone}
            />
            <p id="phone-hint" className="mt-1.5 text-xs text-ink-2">
              Used for delivery updates on this device.
            </p>
            {fieldError("phone")}
          </div>

          <div>
            <label htmlFor="county" className="mb-1.5 block text-sm font-medium">
              County
            </label>
            <select
              id="county"
              name="county"
              aria-invalid={fieldErrors.county ? true : undefined}
              className={inputClass("county")}
              defaultValue={preferences.county}
            >
              <option value="">Not set</option>
              {counties.map((c) => (
                <option key={c.county} value={c.county}>
                  {c.county} — KSh {c.fee.toLocaleString("en-KE")} delivery
                </option>
              ))}
            </select>
            {fieldError("county")}
          </div>

          <div>
            <label htmlFor="town" className="mb-1.5 block text-sm font-medium">
              Town or estate
            </label>
            <input
              id="town"
              name="town"
              autoComplete="address-level2"
              className={inputClass("town")}
              placeholder="e.g. Westlands"
              defaultValue={preferences.town}
            />
            {fieldError("town")}
          </div>

          <div>
            <label htmlFor="street" className="mb-1.5 block text-sm font-medium">
              Street or building{" "}
              <span className="font-normal text-ink-2">(optional)</span>
            </label>
            <input
              id="street"
              name="street"
              autoComplete="address-line1"
              className={inputClass("street")}
              placeholder="e.g. Karen Blk 4, house 12"
              defaultValue={preferences.street}
            />
            {fieldError("street")}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- display */}
      <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
        <h2 className="text-lg font-semibold">Shopping</h2>

        <div className="mt-5 space-y-5">
          <Toggle
            name="showDeliveryEstimate"
            label="Show delivery estimates on product cards"
            hint="How soon a seller says they can dispatch, before you add anything."
            defaultChecked={preferences.showDeliveryEstimate}
          />
          <Toggle
            name="compactGrid"
            label="Compact product grid"
            hint="Fits more products per screen. Prices and seller names stay visible either way."
            defaultChecked={preferences.compactGrid}
          />
          <Toggle
            name="confirmBeforeLeavingCart"
            label="Warn me before leaving a cart with items"
            hint="Items are held for 30 minutes. A prompt avoids losing one at a tab close."
            defaultChecked={preferences.confirmBeforeLeavingCart}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-control bg-brand px-8 text-base font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>

        {/*
          type="button" with its own action, NOT a form reset. A native reset
          restores the DOM to its initial values but never tells the server, so
          the cookie would keep the old preferences and the next render would
          restore them — the button appearing to do nothing.
        */}
        <button
          type="button"
          onClick={handleReset}
          disabled={pending}
          className="h-12 rounded-control border border-hairline px-6 text-base font-semibold text-ink hover:bg-canvas disabled:opacity-60"
        >
          Reset to defaults
        </button>
      </div>
    </form>
  );
}

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      {/*
        A real checkbox. The filters use drawn boxes because they are links,
        where an input would be invalid — but this is a form, so the native
        control is correct: it is focusable, keyboard-operable, and announced
        as a checkbox without an aria hack.
      */}
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[#c2410c]"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-sm text-ink-2">{hint}</span>
      </span>
    </label>
  );
}