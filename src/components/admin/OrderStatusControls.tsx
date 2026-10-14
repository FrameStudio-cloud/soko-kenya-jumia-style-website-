"use client";

import { useActionState } from "react";
import {
  cancelOrderAction,
  updateOrderStatusAction,
  type AdminOrderResult,
} from "@/app/actions/admin/orders";
import {
  ALLOWED_TRANSITIONS,
  STATUS_LABEL,
  type OrderStatus,
} from "@/lib/admin-order-rules";

/*
  Status controls for one order.

  The buttons offered come from ALLOWED_TRANSITIONS, so the UI and the server
  enforcement read the same map. That is the point — if they were two lists they
  would drift, and the drift would show up as a button that fails rather than as
  a button that is missing. A rule that is only in the UI is not a rule.
*/
export function OrderStatusControls({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatus;
}) {
  const allowed = ALLOWED_TRANSITIONS[status];

  if (allowed.length === 0) {
    return (
      <p className="rounded-control border-l-4 border-hairline bg-canvas px-4 py-3 text-sm text-ink-2">
        This order is {STATUS_LABEL[status].toLowerCase()}, which is a final
        state. Its history below is the record.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <StatusForm orderId={orderId} options={allowed} status={status} />
      {allowed.includes("cancelled") && <CancelForm orderId={orderId} />}
    </div>
  );
}

/*
  One form per reachable status rather than one form with a <select>.

  A select needs a submit button to have any effect, which turns "move this
  order on" into three clicks and leaves the operator wondering whether it
  saved. A form per transition is one click and unambiguous — and each still
  sends an explicit to_status, so the server still decides whether it is legal.
*/
function StatusForm({
  orderId,
  options,
  status,
}: {
  orderId: string;
  options: readonly OrderStatus[];
  status: OrderStatus;
}) {
  const [state, formAction, pending] = useActionState<AdminOrderResult | null, FormData>(
    async (previous, formData) =>
      updateOrderStatusAction(orderId, String(formData.get("to_status") ?? ""), formData),
    null,
  );

  const nonCancel = options.filter((option) => option !== "cancelled");
  if (nonCancel.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {nonCancel.map((option) => (
          <form key={option} action={formAction}>
            <input type="hidden" name="to_status" value={option} />
            <input type="hidden" name="actor" value="admin" />
            <label className="sr-only" htmlFor={`note-${option}`}>
              Note for moving to {STATUS_LABEL[option]}
            </label>
            <button
              type="submit"
              disabled={pending}
              className="h-11 rounded-control bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-2 disabled:opacity-60"
            >
              Mark {STATUS_LABEL[option].toLowerCase()}
            </button>
          </form>
        ))}
      </div>

      {state && (
        <p
          role="status"
          className={`text-sm font-medium ${state.ok ? "text-ink-2" : "text-sale"}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

/*
  Cancelling is separate because it needs a written reason AND because it has a
  consequence the others do not: the stock goes back. An operator should have to
  type why.
*/
function CancelForm({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState<AdminOrderResult | null, FormData>(
    async (previous, formData) => cancelOrderAction(orderId, formData),
    null,
  );

  return (
    <form action={formAction} className="rounded-control border-l-4 border-l-sale bg-sale-tint p-4">
      <h3 className="text-sm font-semibold text-ink">Cancel this order</h3>
      <p className="mt-1 text-sm text-ink-2">
        The units go back into stock immediately. Only orders that have not been
        dispatched can be cancelled — anything already on its way is a refund.
      </p>

      <label htmlFor="cancel-reason" className="sr-only">
        Reason for cancelling
      </label>
      <input
        id="cancel-reason"
        name="reason"
        required
        placeholder="Reason, e.g. customer changed their mind"
        className="mt-3 h-11 w-full rounded-control border border-hairline bg-card px-3 text-base text-ink"
      />
      <input type="hidden" name="actor" value="admin" />

      <button
        type="submit"
        disabled={pending}
        className="mt-3 h-11 rounded-control bg-sale px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Cancelling…" : "Cancel and return stock"}
      </button>

      {state && (
        <p
          role="status"
          className={`mt-2 text-sm font-medium ${state.ok ? "text-ink-2" : "text-sale"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}