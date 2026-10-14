"use client";

import { useState, useTransition } from "react";
import { deleteReviewAction } from "@/app/actions/admin/reviews";

/*
  Delete one review, with a confirm step.

  The confirm is not decoration. This is the only destructive action in the
  whole console — every other moderation control moves a column and can be
  moved back — and the delete is a hard one: the row goes, and the product's
  stored rating is recomputed from what is left. Two clicks, and the second one
  says what will happen.

  What makes it recoverable at all is the audit row, which keeps the review id,
  the product, the rating and the text. That is a note in the component's own
  interest: it is why the button does not need a second-guessing "are you
  sure?" dialog and only needs to stop a mis-click.
*/

type Props = {
  reviewId: string;
  productTitle: string;
};

export function DeleteReviewButton({ reviewId, productTitle }: Props) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  function confirm() {
    setFlash(null);
    startTransition(async () => {
      const result = await deleteReviewAction(reviewId);
      setFlash({ ok: result.ok, text: result.message });
      setArmed(false);
    });
  }

  if (!armed && !flash) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="h-9 rounded-control border border-sale px-3 text-xs font-semibold text-sale hover:bg-sale hover:text-white"
      >
        Delete…
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {armed && (
        <div className="rounded-card border border-hairline-2 p-3">
          <p className="text-sm font-semibold">
            Delete this review of “{productTitle}”?
          </p>
          <p className="mt-1 text-xs text-ink-2">
            The review is removed and the product&apos;s rating is recalculated from what is
            left. The audit log keeps the text.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={confirm}
              className="h-9 rounded-control bg-sale px-3 text-xs font-semibold text-white hover:bg-sale/90 disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Yes, delete it"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setArmed(false)}
              className="h-9 rounded-control border border-hairline px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
