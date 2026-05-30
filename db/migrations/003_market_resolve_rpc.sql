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
  VALUES (p_market_id, p_resolver_id, p_outcome, p_method, p_reason);

  UPDATE markets
  SET state = 'resolved',
      resolution = jsonb_build_object('outcome', p_outcome, 'resolved_at', now())
  WHERE id = p_market_id;

  INSERT INTO ledger_entries(user_id, market_id, delta, reason)
  SELECT
    predictions.user_id,
    p_market_id,
    CASE WHEN predictions.choice = p_outcome THEN 1 ELSE -1 END,
    CASE WHEN predictions.choice = p_outcome THEN 'win' ELSE 'loss' END
  FROM predictions
  WHERE predictions.market_id = p_market_id;

  INSERT INTO audit_logs(action, actor_id, meta)
  VALUES (
    'market_resolved',
    p_resolver_id,
    jsonb_build_object('market_id', p_market_id, 'outcome', p_outcome, 'method', p_method)
  );

  RETURN QUERY SELECT p_market_id, 'resolved'::text, p_outcome;
END;
$$;

COMMIT;