-- Leverage support: per-position leverage; raise default max_leverage to 10.
BEGIN;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS leverage integer NOT NULL DEFAULT 1 CHECK (leverage BETWEEN 1 AND 10);
ALTER TABLE market_exchange_config ALTER COLUMN max_leverage SET DEFAULT 10;
COMMIT;
