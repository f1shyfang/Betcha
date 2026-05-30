BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_market_user_reason
  ON ledger_entries(market_id, user_id, reason);

CREATE OR REPLACE FUNCTION market_resolve_with_ledger(
  p_market_id uuid,
  p_resolver_id text,
  p_outcome boolean,
  p_method text,
  p_reason text
) RETURNS TABLE(market_id uuid, state text, resolution_outcome boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_created_at timestamptz;
  v_resolve_by timestamptz;
  v_creator_id text;
  v_resolved_at timestamptz := now();
  v_end_at timestamptz;
  v_early_cutoff timestamptz;
BEGIN
  SELECT created_at, resolve_by, creator_id
  INTO v_created_at, v_resolve_by, v_creator_id
  FROM markets
  WHERE id = p_market_id;

  IF v_created_at IS NULL THEN
    RAISE EXCEPTION 'market not found';
  END IF;

  INSERT INTO resolutions(market_id, resolver_id, outcome, method, reason)
  VALUES (p_market_id, p_resolver_id, p_outcome, p_method, p_reason)
  ON CONFLICT (market_id) DO NOTHING;

  UPDATE markets
  SET state = 'resolved',
      resolution = jsonb_build_object('outcome', p_outcome, 'resolved_at', v_resolved_at)
  WHERE id = p_market_id;

  INSERT INTO ledger_entries(user_id, market_id, delta, reason)
  SELECT
    predictions.user_id,
    p_market_id,
    CASE WHEN predictions.choice = p_outcome THEN 5 ELSE -2 END,
    CASE WHEN predictions.choice = p_outcome THEN 'correct' ELSE 'incorrect' END
  FROM predictions
  WHERE predictions.market_id = p_market_id
  ON CONFLICT (market_id, user_id, reason) DO NOTHING;

  v_end_at := COALESCE(v_resolve_by, v_resolved_at);
  v_early_cutoff := v_created_at + ((v_end_at - v_created_at) / 4.0);

  INSERT INTO ledger_entries(user_id, market_id, delta, reason)
  SELECT
    predictions.user_id,
    p_market_id,
    1,
    'early_bonus'
  FROM predictions
  WHERE predictions.market_id = p_market_id
    AND predictions.created_at <= v_early_cutoff
  ON CONFLICT (market_id, user_id, reason) DO NOTHING;

  IF v_creator_id IS NOT NULL AND v_resolve_by IS NOT NULL AND v_resolved_at <= v_resolve_by THEN
    INSERT INTO ledger_entries(user_id, market_id, delta, reason)
    VALUES (v_creator_id, p_market_id, 2, 'creator_stewardship')
    ON CONFLICT (market_id, user_id, reason) DO NOTHING;
  END IF;

  INSERT INTO audit_logs(action, actor_id, meta)
  VALUES (
    'market_resolved',
    p_resolver_id,
    jsonb_build_object('market_id', p_market_id, 'outcome', p_outcome, 'method', p_method, 'points_version', 2)
  );

  RETURN QUERY SELECT p_market_id, 'resolved'::text, p_outcome;
END;
$$;

COMMIT;
