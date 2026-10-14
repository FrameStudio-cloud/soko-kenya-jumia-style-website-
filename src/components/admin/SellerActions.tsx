"use client";

import { useState, useTransition } from "react";
import {
  suspendSellerAction,
  unsuspendSellerAction,
  unverifySellerAction,
  verifySellerAction,
} from "@/app/actions/admin/sellers";
import { SUSPENSION_REASON_MAX } from "@/lib/admin-moderation-rules";

/*
  Verify / unverify / suspend / unsuspend for one seller.

  Driven by useTransition rather than a form action, because a row offers four
  different actions and `useActionState` binds one action to one form. That
  trades away working-without-JavaScript, which the console already assumes
  everywhere else it mutates something.

  Suspended and verified are separate controls on purpose, and neither is
  derived from the other. Verified says "we have checked them"; suspended says
  "we are refusing to serve them right now". A moderator suspending a verified
  seller should not have to un-verify them first, and reinstating them should
  not hand back a badge as a side effect.
*/

type Props = {
  seller: {
    id: string;
    name: string;
    isVerified: boolean;
    status: string;
  };
};

type Flash = { ok: boolean; text: string } | null;

export function SellerActions({ seller }: Props) {
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<Flash>(null);
  const [reason, setReason] = useState("");

  const suspended = seller.status === "suspended";

  function run(task: () => Promise<{ ok: boolean; message: string }>) {
    setFlash(null);
    startTransition(async () => {
      const result = await task();
      setFlash({ ok: result.ok, text: result.message });
      // Only a suspension that went through clears the box. A rejected attempt
      // leaves the reason in place so the moderator can correct it rather than
      // retype it.
      if (result.ok) setReason("");
    });
  }

  const button =
    "h-9 rounded-control px-3 text-xs font-semibold disabled:opacity-50";
  const quiet =
    "border border-hairline text-ink hover:bg-canvas";
  const danger =
    "border border-sale text-sale hover:bg-sale hover:text-white";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {suspended ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => unsuspendSellerAction(seller.id))}
            className={`${button} bg-ink text-white hover:bg-ink-2`}
          >
            Unsuspend
          </button>
        ) : (
          <>
            {seller.isVerified ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => unverifySellerAction(seller.id))}
                className={`${button} ${quiet}`}
              >
                Remove verification
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => verifySellerAction(seller.id))}
                className={`${button} ${quiet}`}
              >
                Verify
              </button>
            )}

            <details className="group">
              <summary
                className={`${button} ${danger} inline-flex cursor-pointer list-none items-center`}
              >
                Suspend…
              </summary>
              <div className="mt-2 space-y-2 rounded-card border border-hairline-2 p-3">
                <label
                  htmlFor={`reason-${seller.id}`}
                  className="block text-xs font-medium text-ink-3"
                >
                  Why are they being suspended?
                </label>
                <textarea
                  id={`reason-${seller.id}`}
                  value={reason}
                  maxLength={SUSPENSION_REASON_MAX}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  placeholder="Repeated no-shows on orders placed in September."
                  className="w-full rounded-control border border-hairline bg-card p-3 text-sm text-ink"
                />
                <p className="text-xs text-ink-3">
                  Staff only. Never shown to shoppers.
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => suspendSellerAction(seller.id, reason))}
                  className={`${button} bg-sale text-white hover:bg-sale/90`}
                >
                  Confirm suspension
                </button>
              </div>
            </details>
          </>
        )}
      </div>

      {flash && (
        <p
          role={flash.ok ? "status" : "alert"}
          className={`text-xs font-medium ${flash.ok ? "text-ink-2" : "text-sale"}`}
        >
          {flash.text}
        </p>
      )}
    </div>
  );
}
