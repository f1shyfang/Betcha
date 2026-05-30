-- Minimal schema for Betcha MVP (score-only ledger)
-- Neon Postgres. User identity is owned by Better Auth (text ids); the `users`
-- table below is the domain/profile table and FK target. users.id == better-auth user.id.
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE,
  display_name text,
  starting_points integer NOT NULL DEFAULT 2000,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  owner_id text REFERENCES users(id),
  is_private boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES groups(id),
  creator_id text REFERENCES users(id),
  title text,
  type text DEFAULT 'binary',
  state text DEFAULT 'open',
  resolve_by timestamptz,
  resolution jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid REFERENCES markets(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  choice boolean,
  stake_points integer NOT NULL DEFAULT 1 CHECK (stake_points > 0),
  created_at timestamptz DEFAULT now(),
  UNIQUE (market_id, user_id)
);

CREATE TABLE IF NOT EXISTS resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid REFERENCES markets(id) ON DELETE CASCADE,
  resolver_id text REFERENCES users(id),
  outcome boolean,
  method text,
  reason text,
  created_at timestamptz DEFAULT now()
);

-- Enforce single resolution per market at DB level to avoid double-resolve races
CREATE UNIQUE INDEX IF NOT EXISTS ux_resolutions_market_id ON resolutions(market_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text REFERENCES users(id),
  market_id uuid REFERENCES markets(id),
  delta int,
  reason text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES groups(id),
  token text UNIQUE,
  inviter_id text REFERENCES users(id),
  expires_at timestamptz,
  used_by_user_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text,
  actor_id text,
  meta jsonb,
  created_at timestamptz DEFAULT now()
);

-- Idempotency key table
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  response jsonb,
  created_at timestamptz DEFAULT now()
);

-- Waitlist signups
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text,
  source text,
  created_at timestamptz DEFAULT now()
);

COMMIT;
