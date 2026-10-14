import { client, query } from "@/db";
import {
  validateDeliveryAreaEdit,
  type DeliveryAreaFormValues,
} from "@/lib/admin-moderation-rules";

/*
  Delivery area administration: the I/O half.

  There is no create and no delete on this screen either. A delivery area is
  keyed on the county name, which is what a shopper picks at checkout and what
  `orders.delivery_county` records — adding one is a pricing decision and
  removing one would strand orders that already reference it. The active flag
  is the off switch.

  The county name is deliberately not editable. It is the unique key AND the
  value the checkout form matches against, so renaming it would silently detach
  every existing order from its own delivery area and turn a county that works
  into `unsupported_county` overnight.

  What the active flag already does, with no new query work:

    quoteDeliveryEstimate() and its sibling both filter `is_active`, and so
    does the lookup placeOrder() runs. Turning a county off therefore removes
    it from the delivery estimate, makes it unselectable at checkout and
    refuses any order still addressed to it — which is the correct behaviour
    and also a warning worth reading before the first click: deactivating a
    county stops orders from that county, immediately.
*/

export type AdminDeliveryAreaRow = {
  id: string;
  county: string;
  baseFee: number;
  /** NULL means no threshold, which is not the same as 0 (everything ships free). */
  freeDeliveryThreshold: number | null;
  etaDaysMin: number;
  etaDaysMax: number;
  isActive: boolean;
};

export async function listAdminDeliveryAreas(): Promise<AdminDeliveryAreaRow[]> {
  const rows = await query<{
    id: string;
    county: string;
    base_fee: string;
    free_delivery_threshold: string | null;
    eta_days_min: number;
    eta_days_max: number;
    is_active: boolean;
  }>(
    `SELECT id, county, base_fee, free_delivery_threshold,
            eta_days_min, eta_days_max, is_active
       FROM delivery_areas
      ORDER BY county`,
  );

  return rows.map((r) => ({
    id: r.id,
    county: r.county,
    baseFee: Number(r.base_fee),
    freeDeliveryThreshold:
      r.free_delivery_threshold === null ? null : Number(r.free_delivery_threshold),
    etaDaysMin: Number(r.eta_days_min),
    etaDaysMax: Number(r.eta_days_max),
    isActive: r.is_active,
  }));
}

export type DeliveryAreaUpdateResult =
  | { ok: true; message: string; isActiveChanged: boolean }
  | { ok: false; errors: Record<string, string>; message?: string };

export async function updateDeliveryArea({
  deliveryAreaId,
  input,
  actor,
}: {
  deliveryAreaId: string;
  input: DeliveryAreaFormValues;
  actor: string;
}): Promise<DeliveryAreaUpdateResult> {
  const validated = validateDeliveryAreaEdit(input);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  const v = validated.value;

  const conn = await client();
  try {
    await conn.query("BEGIN");

    const current = await conn.query<{
      county: string;
      base_fee: string;
      free_delivery_threshold: string | null;
      eta_days_min: number;
      eta_days_max: number;
      is_active: boolean;
    }>(
      `SELECT county, base_fee, free_delivery_threshold, eta_days_min,
              eta_days_max, is_active
         FROM delivery_areas WHERE id = $1 FOR UPDATE`,
      [deliveryAreaId],
    );
    if (current.rows.length === 0) {
      await conn.query("ROLLBACK");
      return { ok: false, errors: {}, message: "That delivery area no longer exists." };
    }
    const row = current.rows[0];

    const before = {
      baseFee: Number(row.base_fee),
      freeDeliveryThreshold:
        row.free_delivery_threshold === null ? null : Number(row.free_delivery_threshold),
      etaDaysMin: Number(row.eta_days_min),
      etaDaysMax: Number(row.eta_days_max),
    };

    await conn.query(
      `UPDATE delivery_areas
          SET base_fee = $2,
              free_delivery_threshold = $3,
              eta_days_min = $4,
              eta_days_max = $5,
              is_active = $6
        WHERE id = $1`,
      [deliveryAreaId, v.baseFee, v.freeDeliveryThreshold, v.etaDaysMin, v.etaDaysMax, v.isActive],
    );
    await conn.query("COMMIT");

    const feeChanged = before.baseFee !== v.baseFee;
    const thresholdChanged = before.freeDeliveryThreshold !== v.freeDeliveryThreshold;
    const etaChanged = before.etaDaysMin !== v.etaDaysMin || before.etaDaysMax !== v.etaDaysMax;
    const isActiveChanged = row.is_active !== v.isActive;

    if (feeChanged || thresholdChanged || etaChanged || isActiveChanged) {
      const { recordAdminAction } = await import("@/lib/admin-audit");
      await recordAdminAction({
        actor,
        action: "delivery_area_update",
        target: row.county,
        note: [
          feeChanged ? `fee ${before.baseFee} → ${v.baseFee}` : null,
          thresholdChanged
            ? `threshold ${before.freeDeliveryThreshold ?? "none"} → ${
                v.freeDeliveryThreshold ?? "none"
              }`
            : null,
          etaChanged
            ? `eta ${before.etaDaysMin}-${before.etaDaysMax} → ${v.etaDaysMin}-${v.etaDaysMax}`
            : null,
          isActiveChanged ? (v.isActive ? "activated" : "deactivated") : null,
        ]
          .filter(Boolean)
          .join("; "),
      });
    }

    return {
      ok: true,
      isActiveChanged,
      message: isActiveChanged
        ? v.isActive
          ? `Saved. ${row.county} can be delivered to again.`
          : `Saved. ${row.county} can no longer be chosen at checkout, and orders already addressed there will be refused.`
        : "Saved.",
    };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    console.error("updateDeliveryArea failed", err);
    return { ok: false, errors: {}, message: "That could not be saved. Try again." };
  } finally {
    conn.release();
  }
}
