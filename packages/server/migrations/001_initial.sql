-- 001_initial — the whole schema.
--
-- Mirrors IndexedDB schema v6 (src/adapters/storage/schema.ts) plus a `sessions`
-- table the prototype never needed, and adds the integrity IndexedDB could not
-- enforce: uniqueness among active rows, foreign keys, and append-only writes.
--
-- Forward-only. Migrations are never edited once applied (migrate.ts checksums
-- them); a correction is a new numbered file. There are no down-migrations —
-- restores come from backups.
--
-- Naming: snake_case columns mapped to the camelCase domain types by
-- PostgresStore (Phase 2). Timestamps are `timestamptz`; the port's ISO strings
-- convert at the boundary.

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------

-- CLAUDE.md: "Append-only ledger, not a counter+flag… Corrections are `reversal`
-- entries — never destructive edits." In the prototype that is a convention the
-- adapter keeps. Here it is enforced, so no future route, migration or hand-run
-- UPDATE can quietly rewrite history.
CREATE FUNCTION reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- ---------------------------------------------------------------------------
-- program_config — exactly one row
-- ---------------------------------------------------------------------------

CREATE TABLE program_config (
  id                         text PRIMARY KEY DEFAULT 'singleton'
                               CHECK (id = 'singleton'),
  points_per_reward          integer NOT NULL CHECK (points_per_reward > 0),
  reward_description         text    NOT NULL,
  points_per_purchase        integer NOT NULL CHECK (points_per_purchase > 0),
  max_points_per_transaction integer NOT NULL CHECK (max_points_per_transaction > 0),
  card_inactivity_days       integer NOT NULL CHECK (card_inactivity_days >= 0),

  -- Admin "sign out all devices". Never decreases; compared against the epoch
  -- stamped on each session row.
  session_epoch              integer NOT NULL DEFAULT 0 CHECK (session_epoch >= 0),

  -- Acknowledged suspicious-activity alerts. Alerts are derived, not stored, so
  -- dismissal is recorded here and filtered out of getAlerts.
  dismissed_alerts           text[]  NOT NULL DEFAULT '{}',

  -- Appendix E detector thresholds, admin-tunable in Configure. Bounds are the
  -- server-side clamp BACKEND-PLAN §3-B-12 requires: ConfigService.sanitizeConfig
  -- runs on the client, which is presentation, not enforcement.
  self_deal_window_sec       integer NOT NULL CHECK (self_deal_window_sec  BETWEEN 1 AND 3600),
  self_deal_count            integer NOT NULL CHECK (self_deal_count       BETWEEN 2 AND 100),
  repeat_count               integer NOT NULL CHECK (repeat_count          BETWEEN 2 AND 100),
  repeat_window_min          integer NOT NULL CHECK (repeat_window_min     BETWEEN 1 AND 1440),

  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- Values mirror DEFAULT_CONFIG in src/adapters/storage/schema.ts. Reward
-- threshold 9: nine purchases earn the reward, and the card shows threshold + 1
-- cups (nine earnable plus the pre-stamped free one).
INSERT INTO program_config (
  id, points_per_reward, reward_description, points_per_purchase,
  max_points_per_transaction, card_inactivity_days,
  self_deal_window_sec, self_deal_count, repeat_count, repeat_window_min
) VALUES (
  'singleton', 9, 'Free regular coffee', 1,
  3, 0,
  30, 3, 3, 30
) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- staff_accounts
-- ---------------------------------------------------------------------------

CREATE TABLE staff_accounts (
  id            text        PRIMARY KEY,
  username      text        NOT NULL,
  -- Display/attribution label. Falls back to username when absent.
  name          text,
  -- argon2id, hashed server-side from the plaintext (BACKEND-PLAN §4-A). The
  -- client never hashes: whatever the client sends IS the credential.
  password_hash text        NOT NULL,
  -- argon2id too, and nullable — accounts may exist without a quick-unlock PIN.
  pin_hash      text,
  role          text        NOT NULL CHECK (role IN ('admin', 'staff')),
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive: "Admin" and "admin" must not be two accounts.
CREATE UNIQUE INDEX staff_accounts_username_key ON staff_accounts (lower(username));

-- Deliberately NO unique constraint on the PIN. SCOPE-DECISIONS §3.6: against
-- argon2id hashes it is not implementable at all, and it is no longer needed —
-- a PIN is verified against an account the device has already identified, never
-- searched for across the table.

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------

CREATE TABLE customers (
  id           text        PRIMARY KEY,
  -- Random opaque 128-bit token — the identity, and what the QR carries. Never
  -- derived from name/email/phone.
  token        text,
  -- Crockford-base32 handle, the camera-fail fallback. Not the identity.
  short_code   text,
  display_name text,
  email        text,
  phone        text,
  status       text        NOT NULL CHECK (status IN ('active', 'deleted')),
  consent_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,

  -- SCOPE-DECISIONS §2.1: name and email are REQUIRED at registration. This is
  -- the biggest schema-level difference from the prototype, which allows
  -- token-only cards.
  CONSTRAINT customers_active_fields_present CHECK (
    status <> 'active' OR (
      token IS NOT NULL AND short_code IS NOT NULL
      AND display_name IS NOT NULL AND email IS NOT NULL
    )
  ),

  -- SCOPE-DECISIONS §3.3: deletion is a tombstone. The row survives as
  -- (id, created_at, status) so the ledger stays internally consistent and shop
  -- totals stay correct; everything that resolves to a person is erased, the
  -- dead token can never be scanned again, and the address is freed for
  -- re-registration. The nullability above exists ONLY for this state.
  CONSTRAINT customers_deleted_fields_erased CHECK (
    status <> 'deleted' OR (
      token IS NULL AND short_code IS NULL AND display_name IS NULL
      AND email IS NULL AND phone IS NULL
    )
  ),

  CONSTRAINT customers_deleted_at_matches_status CHECK (
    (status = 'deleted') = (deleted_at IS NOT NULL)
  )
);

-- Tokens are globally unique, forever — a tombstoned token is NULL, so a
-- reissued one can never collide with a retired one either.
CREATE UNIQUE INDEX customers_token_key ON customers (token);
-- Short codes need only be unique among live cards (BACKEND-PLAN §3-A-2).
CREATE UNIQUE INDEX customers_short_code_active_key
  ON customers (short_code) WHERE status = 'active';
-- SCOPE-DECISIONS §3.4: one card per email address, case-insensitively. The
-- tombstone's erased email does not occupy the address.
CREATE UNIQUE INDEX customers_email_active_key
  ON customers (lower(email)) WHERE status = 'active';
CREATE INDEX customers_status_idx ON customers (status);

-- ---------------------------------------------------------------------------
-- loyalty_transactions — the append-only points ledger
-- ---------------------------------------------------------------------------

CREATE TABLE loyalty_transactions (
  id                       text        PRIMARY KEY,
  customer_id              text        NOT NULL REFERENCES customers (id),
  -- 'redemption' is deliberately absent: the rewards-as-objects rework replaced
  -- it with 'reward_issue' (a minting accrual of -threshold that spawns a
  -- discrete Reward). The domain union still carries it transitionally; the
  -- ledger must never receive one.
  type                     text        NOT NULL
                             CHECK (type IN ('accrual', 'reward_issue', 'reversal')),
  -- Signed: +N accrual, -threshold reward_issue, ± reversal. Balance is the sum
  -- of these, never a stored counter.
  points                   integer     NOT NULL,
  -- No FK: staff accounts can be hard-deleted and historical attribution must
  -- survive that. See the same note on audit_log.
  staff_id                 text        NOT NULL,
  timestamp                timestamptz NOT NULL DEFAULT now(),
  note                     text,
  reverses_transaction_id  text        REFERENCES loyalty_transactions (id),
  reward_id                text,

  -- A reversal points at what it reverses; nothing else may.
  CONSTRAINT loyalty_transactions_reversal_target CHECK (
    (type = 'reversal') OR reverses_transaction_id IS NULL
  )
);

CREATE INDEX loyalty_transactions_customer_ts_idx
  ON loyalty_transactions (customer_id, timestamp);
CREATE INDEX loyalty_transactions_reward_idx
  ON loyalty_transactions (reward_id) WHERE reward_id IS NOT NULL;

CREATE TRIGGER loyalty_transactions_append_only
  BEFORE UPDATE OR DELETE ON loyalty_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- rewards — materialized projection (mutable), source of truth is reward_events
-- ---------------------------------------------------------------------------

CREATE TABLE rewards (
  id                   text        PRIMARY KEY,
  -- Opaque 128-bit token, carried in the reward QR.
  token                text        NOT NULL UNIQUE,
  -- Crockford-base32, MANUAL / camera-fail path only — never in the QR.
  short_code           text        NOT NULL UNIQUE,
  owner_id             text        NOT NULL REFERENCES customers (id),
  -- 'transfer_pending' is reserved for gifting (deferred, schema-reserved only).
  status               text        NOT NULL
                         CHECK (status IN ('unspent', 'spent', 'voided', 'transfer_pending')),
  issued_at            timestamptz NOT NULL,
  source_txn_id        text        NOT NULL REFERENCES loyalty_transactions (id),
  -- rewardDescription captured at mint time, so history stays stable when an
  -- admin edits the program.
  description_snapshot text        NOT NULL,
  spent_at             timestamptz,
  spent_by_staff_id    text,

  CONSTRAINT rewards_spent_fields CHECK (
    (status = 'spent') = (spent_at IS NOT NULL)
  )
);

CREATE INDEX rewards_owner_idx ON rewards (owner_id);
CREATE INDEX rewards_status_idx ON rewards (status);
-- The hot read: "this customer's unspent rewards" — the count that drives the card.
CREATE INDEX rewards_owner_status_idx ON rewards (owner_id, status);

-- ---------------------------------------------------------------------------
-- reward_events — append-only reward lifecycle; THE source of truth for status
-- ---------------------------------------------------------------------------

CREATE TABLE reward_events (
  id          text        PRIMARY KEY,
  reward_id   text        NOT NULL REFERENCES rewards (id),
  type        text        NOT NULL
                CHECK (type IN ('reward.issued', 'reward.redeemed', 'reward.voided')),
  customer_id text        NOT NULL REFERENCES customers (id),
  staff_id    text,
  timestamp   timestamptz NOT NULL DEFAULT now(),
  -- Free-form context, e.g. {"reason": "correction"}. Never PII.
  details     jsonb
);

CREATE INDEX reward_events_reward_idx ON reward_events (reward_id, timestamp);
CREATE INDEX reward_events_owner_idx ON reward_events (customer_id, timestamp);

CREATE TRIGGER reward_events_append_only
  BEFORE UPDATE OR DELETE ON reward_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- idempotency_keys — commit dedup cache
-- ---------------------------------------------------------------------------

-- Appendix E stripped the commit-effect columns the retired post-commit undo
-- needed, so this is a CACHE, not a record: a retried commit replays the cached
-- CommitResult with no second write. Because it is a cache it can be swept —
-- hence the created_at index.
CREATE TABLE idempotency_keys (
  key        text        PRIMARY KEY,
  result     jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);

-- ---------------------------------------------------------------------------
-- recovery_codes
-- ---------------------------------------------------------------------------

-- SCOPE-DECISIONS §2.3: recovery is a short code the customer TYPES on the
-- device in their hand. A short code is not a secret on its own, so `attempts`
-- carries the lockout that length no longer does. Hashed at rest, single-use,
-- short expiry. Maps to a customer id only — never any PII.
CREATE TABLE recovery_codes (
  id          text        PRIMARY KEY,
  code_hash   text        NOT NULL,
  customer_id text        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  attempts    integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recovery_codes_customer_idx ON recovery_codes (customer_id);
CREATE INDEX recovery_codes_expires_idx ON recovery_codes (expires_at);

-- ---------------------------------------------------------------------------
-- audit_log — append-only action trail
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id         text        PRIMARY KEY,
  -- No FK, same reason as loyalty_transactions.staff_id: deleting an account
  -- must not erase or block what it did. 'system' is also a valid actor.
  actor_id   text        NOT NULL,
  actor_role text        NOT NULL CHECK (actor_role IN ('admin', 'staff', 'system')),
  -- The AuditAction union, minus 'audit.export': the triage dropped the export
  -- surface entirely (SCOPE-DECISIONS §1, BACKEND-PLAN §4-F resolved by
  -- deletion), so there is nothing that may write that row.
  action     text        NOT NULL CHECK (action IN (
                 'staff.login', 'staff.login.failed', 'staff.create', 'staff.disable',
                 'staff.enable', 'staff.delete', 'staff.resetPassword',
                 'card.issue', 'card.reissue', 'card.provision',
                 'customer.register', 'customer.recover', 'customer.correct',
                 'customer.delete',
                 'loyalty.accrue', 'loyalty.redeem', 'loyalty.reverse',
                 'config.update')),
  target_id  text,
  -- Free-form context. Must never contain PII (name/email/phone).
  details    text,
  timestamp  timestamptz NOT NULL DEFAULT now()
);

-- The three shapes the ranged AuditFilter reads in. That query is an INTERNAL
-- server capability feeding the detectors (SCOPE-DECISIONS §3.1) — no route is
-- attached to it, and none may be.
CREATE INDEX audit_log_timestamp_idx ON audit_log (timestamp);
CREATE INDEX audit_log_action_timestamp_idx ON audit_log (action, timestamp);
CREATE INDEX audit_log_actor_timestamp_idx ON audit_log (actor_id, timestamp);

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- sessions — the table the prototype never needed
-- ---------------------------------------------------------------------------

-- Server-side rows behind an HttpOnly, Secure, SameSite=Lax cookie, for staff
-- AND customers. The customer half is the point of the whole backend: a
-- server-set HttpOnly cookie is the only card recognition that survives iOS ITP.
-- Server-side rows are also what make sessionEpoch revocation real — "sign out
-- all devices" deletes rows rather than waiting for a token to expire.
CREATE TABLE sessions (
  id              text        PRIMARY KEY,
  -- Only the hash is stored: a stolen database must not yield live sessions.
  token_hash      text        NOT NULL UNIQUE,
  kind            text        NOT NULL CHECK (kind IN ('staff', 'customer')),
  staff_id        text        REFERENCES staff_accounts (id) ON DELETE CASCADE,
  customer_id     text        REFERENCES customers (id) ON DELETE CASCADE,
  -- Snapshot of program_config.session_epoch at issue; anything older is forced
  -- to re-auth.
  session_epoch   integer     NOT NULL DEFAULT 0,
  -- CSRF double-submit partner token, hashed for the same reason.
  csrf_token_hash text,
  -- "Remember this device" — a trusted terminal, which re-auths with the quick
  -- PIN after the idle lock rather than the full form.
  remembered      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Drives the 5-minute idle lock, enforced here rather than only in AuthContext.
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,

  CONSTRAINT sessions_subject CHECK (
    (kind = 'staff'    AND staff_id    IS NOT NULL AND customer_id IS NULL) OR
    (kind = 'customer' AND customer_id IS NOT NULL AND staff_id    IS NULL)
  )
);

CREATE INDEX sessions_staff_idx ON sessions (staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX sessions_customer_idx ON sessions (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
