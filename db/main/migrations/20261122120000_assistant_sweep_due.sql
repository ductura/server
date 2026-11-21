-- migrate:up
-- SRV-1205 (Val 12 / M9.0-S2, Ductus#2052): step 5 of the contract
-- Ductus docs/contracts/ai-request-v1.md, the worker's job of sweeping and
-- settling ("Stanja", "Matrica pristupa": the worker reads the state and the
-- ids of a request, nothing else).
--
--   assistant.sweep_due   the worker: the ids of the requests the sweep would change now
--
-- The job carries only a request id (M10), and the web process cannot reach
-- the queue (106-pgboss-queue.sql), so the worker finds the ids itself: a
-- request reserved longer than assistant.stale_reserved_after(), one sent
-- longer than assistant.stale_sent_after(), and every outcome_unknown. These
-- are exactly the rows on which assistant.sweep_and_settle (20261122110000)
-- changes something; the deadlines are its named constants, not repeated here.
-- The answer is ids only, oldest request first: no student, institution,
-- amount, purpose, text or state leaves the schema. The bound of a call is
-- 1 to 1000 ids; anything else is ZD422.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA assistant TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION assistant.sweep_due(p_limit integer) RETURNS TABLE (request_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  RETURN QUERY
    SELECT q.id FROM assistant.request q
     WHERE (q.state = 'reserved' AND q.requested_at <= now() - assistant.stale_reserved_after())
        OR (q.state = 'sent' AND q.sent_at <= now() - assistant.stale_sent_after())
        OR q.state = 'outcome_unknown'
     ORDER BY q.requested_at, q.id
     LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION assistant.sweep_due(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assistant.sweep_due(integer) TO ductus_worker;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA assistant FROM ductus_identity;

-- migrate:down
-- Local only; staging and production only go forward (docs/BACKEND.md §6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA assistant TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION assistant.sweep_due(integer);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA assistant FROM ductus_identity;
