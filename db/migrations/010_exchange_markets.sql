-- Exchange market type: a CLOB on a binary contract with signed positions,
-- escrow, and (later) leverage. See spec 2026-06-01-exchange-market-clob-design.md.
BEGIN;

-- Distinguish the existing one-tap "quick" market from the new "exchange" market.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS mechanism text NOT NULL DEFAULT 'quick';

-- Per-market exchange configuration (one row per exchange market).
CREATE TABLE IF NOT EXISTS market_exchange_config (
  market_id uuid PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  seed_price integer NOT NULL DEFAULT 50 CHECK (seed_price BETWEEN 1 AND 99),
  max_leverage integer NOT NULL DEFAULT 1 CHECK (max_leverage BETWEEN 1 AND 10),
  tick integer NOT NULL DEFAULT 1,
  maintenance_margin integer NOT NULL DEFAULT 3,
  bot_spread integer NOT NULL DEFAULT 4,
  bot_levels integer NOT NULL DEFAULT 5,
  bot_size_per_level integer NOT NULL DEFAULT 50,
  bot_max_inventory integer NOT NULL DEFAULT 500,
  created_at timestamptz DEFAULT now()
);

-- The order book. user_id may be a per-market bot account (a real users row).
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  price integer NOT NULL CHECK (price BETWEEN 1 AND 99),
  quantity integer NOT NULL CHECK (quantity > 0),
  filled_quantity integer NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  leverage integer NOT NULL DEFAULT 1 CHECK (leverage BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','partial','filled','cancelled','liquidation')),
  sequence bigserial NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_orders_book
  ON orders(market_id, side, price, sequence) WHERE status IN ('open','partial');

-- Executed trades = the price tape.
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  price integer NOT NULL CHECK (price BETWEEN 1 AND 99),
  quantity integer NOT NULL CHECK (quantity > 0),
  taker_order_id uuid REFERENCES orders(id),
  maker_order_id uuid REFERENCES orders(id),
  taker_user text REFERENCES users(id),
  maker_user text REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_trades_market_time ON trades(market_id, created_at DESC);

-- Signed net position per (market, user).
CREATE TABLE IF NOT EXISTS positions (
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shares integer NOT NULL DEFAULT 0,
  avg_entry numeric NOT NULL DEFAULT 0,
  margin_posted integer NOT NULL DEFAULT 0,
  realized_pnl integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (market_id, user_id)
);

-- App-seeded insurance pool absorbing liquidation shortfalls (per market).
CREATE TABLE IF NOT EXISTS insurance_pool (
  market_id uuid PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

COMMIT;
