BEGIN;

CREATE OR REPLACE FUNCTION market_resolve_with_ledger(
  p_market_id uuid,
  p_resolver_id text,
  p_outcome boolean,
  p_method text,
  p_reason text
) RETURNS TABLE(market_id uuid, state text, resolution_outcome boolean)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO resolutions(market_id, resolver_id, outcome, method, reason)
  SELECT p_market_id, p_resolver_id, p_outcome, p_method, p_reason
  WHERE NOT EXISTS (
    SELECT 1
    FROM resolutions r
    WHERE r.market_id = p_market_id
  );

  UPDATE markets
  SET state = 'resolved',
      resolution = jsonb_build_object('outcome', p_outcome, 'resolved_at', now())
  WHERE id = p_market_id;

  -- Winner receives 2x stake payout. Since stake was already debited at bet time,
  -- winner net is +stake and loser net is -stake.
  INSERT INTO ledger_entries(user_id, market_id, delta, reason)
  SELECT
    p.user_id,
    p_market_id,
    (p.stake_points * 2),
    'wager_win_payout'
  FROM predictions p
  WHERE p.market_id = p_market_id
    AND p.choice = p_outcome
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_entries le
      WHERE le.market_id = p_market_id
        AND le.user_id = p.user_id
        AND le.reason = 'wager_win_payout'
    );

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
