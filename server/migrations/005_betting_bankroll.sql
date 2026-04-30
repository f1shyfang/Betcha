BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS starting_points integer NOT NULL DEFAULT 2000;

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS stake_points integer NOT NULL DEFAULT 1;

UPDATE predictions
SET stake_points = 1
WHERE stake_points IS NULL OR stake_points <= 0;

ALTER TABLE predictions
  ADD CONSTRAINT predictions_stake_points_positive CHECK (stake_points > 0);

CREATE OR REPLACE FUNCTION market_resolve_with_ledger(
  p_market_id uuid,
  p_resolver_id uuid,
  p_outcome boolean,
  p_method text,
  p_reason text
) RETURNS TABLE(market_id uuid, state text, resolution_outcome boolean)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO resolutions(market_id, resolver_id, outcome, method, reason)
  VALUES (p_market_id, p_resolver_id, p_outcome, p_method, p_reason)
  ON CONFLICT (market_id) DO NOTHING;

  UPDATE markets
  SET state = 'resolved',
      resolution = jsonb_build_object('outcome', p_outcome, 'resolved_at', now())
  WHERE id = p_market_id;

  -- Winner receives 2x stake payout. Since stake was already debited at bet time,
  -- winner net is +stake and loser net is -stake.
  INSERT INTO ledger_entries(user_id, market_id, delta, reason)
  SELECT
    predictions.user_id,
    p_market_id,
    (predictions.stake_points * 2),
    'wager_win_payout'
  FROM predictions
  WHERE predictions.market_id = p_market_id
    AND predictions.choice = p_outcome
  ON CONFLICT (market_id, user_id, reason) DO NOTHING;

  INSERT INTO audit_logs(action, actor_id, meta)
  VALUES (
    'market_resolved',
    p_resolver_id,
    jsonb_build_object('market_id', p_market_id, 'outcome', p_outcome, 'method', p_method, 'bankroll_mode', true)
  );

  RETURN QUERY SELECT p_market_id, 'resolved'::text, p_outcome;
END;
$$;

COMMIT;
