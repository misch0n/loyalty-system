-- 002_retire_pin — the staff PIN and the idle lock are gone (UI-1b).
--
-- SCOPE-DECISIONS §6.3 / register S1: the staff device is a shared till. There
-- is no quick-unlock PIN and no idle lock; a login lasts until its absolute
-- TTL (30 days remembered, 12 hours otherwise). Attribution is the signed-in
-- ACCOUNT — audit rows, the counter's "your last hour" and both alert detectors
-- are per account, not per person at the till.
--
-- Forward-only, like every file here: 001 is never edited. Dropping the column
-- discards every stored PIN digest, which is the point — a credential nothing
-- verifies any more is only something to leak.

ALTER TABLE staff_accounts DROP COLUMN pin_hash;

-- 001's inline comments on these two columns describe the retired idle lock;
-- the catalogue says what they mean now.
COMMENT ON COLUMN sessions.remembered IS
  '"Remember me": the session lasts the long TTL (30 days) instead of 12 hours. No idle lock.';
COMMENT ON COLUMN sessions.last_seen_at IS
  'Last request on this session. Bookkeeping only since 002 — nothing expires on it.';
