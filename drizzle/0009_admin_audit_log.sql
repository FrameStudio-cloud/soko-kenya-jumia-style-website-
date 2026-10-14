-- ---------------------------------------------------------------------------
-- Admin audit log
-- ---------------------------------------------------------------------------
--
-- The admin console can see things shoppers cannot: full delivery addresses,
-- phone numbers, and every order in the business. Masking customer data by
-- default is only a privacy control if somebody can afterwards answer "who
-- looked, and when".
--
-- order_status_history is not the place for this. It is about an ORDER's state,
-- keyed by order_id, and a reveal changes no status — writing one would invent
-- a status transition that never happened and corrupt the sequence that a
-- dispute depends on.
--
-- So this is a separate, append-only log keyed on what was ACCESSED rather than
-- what changed.
--
-- (No ALTER of sellers_status_valid here, despite what an earlier draft of this
-- file did. Dropping 0008's constraint without re-adding it would leave the
-- seller status column unconstrained.)
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor" text NOT NULL,
  "action" text NOT NULL,
  "target" text,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_audit_log_created_idx"
  ON "admin_audit_log" ("created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_audit_log_action_idx"
  ON "admin_audit_log" ("action", "created_at" DESC);
--> statement-breakpoint

COMMENT ON TABLE "admin_audit_log" IS
  'Append-only record of admin reads and writes. The point is to answer "who '
  'looked at this customer''s address" — masking without an audit trail is just '
  'obfuscation, since anyone with database access can read the column directly.';
--> statement-breakpoint
COMMENT ON COLUMN "admin_audit_log"."actor" IS
  'Who acted. Free text, matching order_status_history.changed_by: there is no '
  'identities table yet, so this is a label ("admin") rather than an account id.';
--> statement-breakpoint
COMMENT ON COLUMN "admin_audit_log"."target" IS
  'What was acted on — an order reference, a product slug. Null for events with '
  'no target, such as a sign-in attempt.';
--> statement-breakpoint
COMMENT ON COLUMN "admin_audit_log"."note" IS
  'Free-text detail. Never store the revealed customer data itself: this log is '
  'read more often than the orders table, and copying PII into it would defeat '
  'the masking it is recording.';