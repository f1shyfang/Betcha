-- Exchange settlement: resolve an exchange market by booking each position's
-- terminal payout. Cash model already booked premiums at fill time, so
-- settlement adds delta = (outcome?100:0) * shares per position (zero-sum,
-- since every bought share was sold => sum(shares)=0). Cancels open orders.
BEGIN;

DROP FUNCTION IF EXISTS market_resolve_exchange(uuid, text, boolean, text, text);

CREATE OR REPLACE FUNCTION market_resolve_exchange(
  p_market_id uuid,
  p_resolver_id text,
  p_outcome boolean,
  p_method text,
  p_reason text
) RETURNS TABLE(out_market_id uuid, out_state text, out_resolution_outcome boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_terminal int := CASE WHEN p_outcome THEN 100 ELSE 0 END;
  v_inserted int;
BEGIN
  -- Claim the resolution. The unique index on resolutions(market_id) makes this
  -- the atomic gate: exactly one caller inserts a row (ROW_COUNT=1); a repeat or
  -- concurrent call conflicts (ROW_COUNT=0) and must NOT settle again.
  INSERT INTO resolutions(market_id, resolver_id, outcome, method, reason)
  VALUES (p_market_id, p_resolver_id, p_outcome, p_method, p_reason)
  ON CONFLICT (market_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    -- Already resolved; do nothing further (idempotent no-op).
    RETURN QUERY SELECT p_market_id, 'resolved'::text, p_outcome;
    RETURN;
  END IF;

  UPDATE markets
  SET state = 'resolved',
      resolution = jsonb_build_object('outcome', p_outcome, 'resolved_at', now())
  WHERE id = p_market_id;

  UPDATE orders SET status = 'cancelled'
  WHERE market_id = p_market_id AND status IN ('open','partial');

  -- Terminal payout per non-flat position (skip inert zero-delta rows on NO).
  INSERT INTO ledger_entries(user_id, market_id, delta, reason)
  SELECT user_id, p_market_id, (v_terminal * shares), 'settlement'
  FROM positions
  WHERE market_id = p_market_id AND shares <> 0 AND (v_terminal * shares) <> 0;

  INSERT INTO audit_logs(action, actor_id, meta)
  VALUES ('market_resolved', p_resolver_id,
          jsonb_build_object('market_id', p_market_id, 'outcome', p_outcome, 'method', p_method, 'exchange', true));

  RETURN QUERY SELECT p_market_id, 'resolved'::text, p_outcome;
END;
$$;

COMMIT;
