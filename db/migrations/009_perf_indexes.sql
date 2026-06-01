-- Performance indexes for hot read paths.
--
-- ledger_entries(user_id): every balance lookup runs
--   SELECT SUM(delta) FROM ledger_entries WHERE user_id = $1
-- The existing ux_ledger_market_user_reason index leads with market_id, so it
-- can't serve a user_id lookup. Without this, balance is a sequential scan.
--
-- markets(group_id): the leaderboard resolves a group's markets with
--   WHERE group_id = $1
-- and the markets-list endpoint filters the same way. markets had no index here.
--
-- Tables are small at current scale, so a plain (non-CONCURRENT) build is fine
-- and keeps the migration transactional like the others. If these tables grow
-- large, rebuild these with CREATE INDEX CONCURRENTLY outside a transaction.
BEGIN;

CREATE INDEX IF NOT EXISTS ix_ledger_entries_user_id ON ledger_entries (user_id);
CREATE INDEX IF NOT EXISTS ix_markets_group_id ON markets (group_id);

COMMIT;
