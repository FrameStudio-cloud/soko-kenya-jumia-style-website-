import { client } from "@/db";

/*
  Admin audit trail.

  A separate connection and a separate transaction from whatever triggered it.
  That is not tidiness: a reveal that writes its audit row inside the caller's
  transaction rolls back with the caller's failure, so a refused action would
  leave no trace that anyone tried. The one thing an audit log must never do is
  disappear when the thing it is auditing does.

  Failures here are swallowed on purpose. An audit write that throws must not
  take down the admin screen — but it is also a real gap, so it reports to
  stderr rather than vanishing.
*/
export async function recordAdminAction({
  actor,
  action,
  target,
  note,
}: {
  actor: string;
  action: string;
  target?: string | null;
  note?: string | null;
}): Promise<void> {
  const conn = await client();
  try {
    await conn.query(
      `INSERT INTO admin_audit_log (actor, action, target, note)
            VALUES ($1, $2, $3, $4)`,
      [actor, action, target ?? null, note ?? null],
    );
  } catch (err) {
    console.error("admin_audit_log: write failed", err);
  } finally {
    conn.release();
  }
}