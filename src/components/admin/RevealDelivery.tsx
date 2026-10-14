"use client";

import { useState, useTransition } from "react";
import { revealDeliveryAction } from "@/app/actions/admin/orders";

/*
  Masked delivery details, with a reveal.

  The masked values come from the server and are already safe to render. The
  unmasked ones only exist after a server action returns them, and that action
  writes an audit row first — so there is no code path where the browser holds a
  customer's address without a record that it asked for it.

  Revealed state is local and does not survive a reload. That is intentional: a
  page left open on a monitor is the most likely way this data ends up in the
  wrong hands, and re-navigating should put the mask back.
*/
export function RevealDelivery({
  orderId,
  reference,
  recipientName,
  town,
  street,
  phone,
  hasPhone,
}: {
  orderId: string;
  reference: string;
  recipientName: string | null;
  town: string | null;
  street: string | null;
  phone: string | null;
  hasPhone: boolean;
}) {
  const [revealed, setRevealed] = useState<{
    recipientName: string | null;
    town: string | null;
    street: string | null;
    phone: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reveal() {
    setError(null);
    startTransition(async () => {
      const result = await revealDeliveryAction(orderId, reference);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRevealed({
        recipientName: result.recipientName ?? null,
        town: result.town ?? null,
        street: result.street ?? null,
        phone: result.phone ?? null,
      });
    });
  }

  function hide() {
    setRevealed(null);
  }

  const shown = revealed;

  return (
    <div>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-3">Recipient</dt>
          <dd>{shown?.recipientName ?? recipientName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Town</dt>
          <dd>{shown?.town ?? town ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Street</dt>
          <dd>{shown?.street ?? street ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Phone</dt>
          <dd>{shown?.phone ?? phone ?? (hasPhone ? "—" : "Not given")}</dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center gap-3">
        {shown ? (
          <button
            type="button"
            onClick={hide}
            className="h-11 rounded-control border border-hairline px-4 text-sm font-semibold text-ink hover:bg-canvas"
          >
            Hide
          </button>
        ) : (
          <button
            type="button"
            onClick={reveal}
            disabled={pending}
            className="h-11 rounded-control border border-hairline px-4 text-sm font-semibold text-ink hover:bg-canvas disabled:opacity-60"
          >
            {pending ? "Recording…" : "Reveal full details"}
          </button>
        )}
        <p className="text-xs text-ink-3">Every reveal is recorded.</p>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-sale">
          {error}
        </p>
      )}
    </div>
  );
}