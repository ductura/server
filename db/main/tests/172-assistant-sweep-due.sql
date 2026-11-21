-- SRV-1205 (Val 12 / M9.0-S2, Ductus#2052): the worker's listing of the
-- requests the sweep would change now (migration 20261122120000), step 5 of
-- Ductus docs/contracts/ai-request-v1.md ("Stanja"; "Matrica pristupa": the
-- worker reads the state and ids of a request, through an RPC, nothing else).
--   1. the catalogue: a STABLE SECURITY DEFINER of the owner role with an empty
--      search_path that answers ids only, run by the worker alone (M1, M10);
--   2. exactly the stale reserved, the stale sent and every outcome_unknown,
--      oldest first, within the bound; nothing else (no terminal state, no
--      fresh row);
--   3. after sweep_and_settle over each listed id the listing is empty, and a
--      second sweep changes nothing.
-- Rows are written directly with old times (the clock of one transaction
-- does not move). Every person and text is invented; providers and models are
-- provider-test-a and model-test-1 (S4).
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

CREATE FUNCTION pg_temp.key(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-000000172' || lpad(p_n::text, 3, '0'))::uuid
$$;
CREATE FUNCTION pg_temp.rid(p_n integer) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM assistant.request WHERE idempotency_key = pg_temp.key(p_n) AND student_id = pg_temp.id('ana')
$$;
-- The listing as the worker, read back as the test's own role: the keys of
-- the listed rows of this file, in the order listed, or the error.
CREATE FUNCTION pg_temp.due(p_limit integer DEFAULT 1000) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_ids text := pg_temp.ask_as('ductus_worker', 'anon', format(
    $q$ SELECT coalesce(string_agg(request_id::text, ',' ORDER BY n), '')
          FROM assistant.sweep_due(%s) WITH ORDINALITY AS d (request_id, n) $q$, coalesce(p_limit::text, 'NULL')));
BEGIN
  IF v_ids ~ '^[0-9A-Z]{5}: ' THEN
    RETURN v_ids;
  END IF;
  RETURN (SELECT coalesce(string_agg(right(r.idempotency_key::text, 3), ',' ORDER BY x.n), '')
            FROM unnest(string_to_array(nullif(v_ids, ''), ',')) WITH ORDINALITY AS x (id, n)
            JOIN assistant.request r ON r.id = x.id::uuid
           WHERE r.idempotency_key IN (SELECT pg_temp.key(k) FROM generate_series(1, 10) AS k));
END
$$;

-- 1. Catalogue.
SELECT ok((SELECT p.prosecdef AND p.proowner = 'ductus_identity'::regrole AND p.proconfig = ARRAY['search_path=""']
             AND p.provolatile = 's'
           FROM pg_proc p WHERE p.oid = 'assistant.sweep_due(integer)'::regprocedure),
  'the listing is a STABLE SECURITY DEFINER of the owner role with an empty search_path');
SELECT is(pg_get_function_result('assistant.sweep_due(integer)'::regprocedure), 'TABLE(request_id uuid)',
  'the listing answers request ids only: no student, institution, amount, purpose, text or state (M10)');
SELECT ok(has_function_privilege('ductus_worker', 'assistant.sweep_due(integer)'::regprocedure, 'EXECUTE'),
  'the worker runs the listing');
SELECT is_empty(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_app_local',
                                'ductus_auth_local', 'public']) AS r
      WHERE has_function_privilege(r, 'assistant.sweep_due(integer)'::regprocedure, 'EXECUTE') $$,
  'no other runtime role runs the listing, nor PUBLIC');
SELECT is(pg_temp.ask('ana', 'SELECT count(*)::text FROM assistant.sweep_due(10)'),
  '42501: permission denied for function sweep_due', 'the web process cannot list');
SELECT is(pg_temp.ask_as('ductus_worker', 'anon', 'SELECT count(*)::text FROM assistant.request'),
  '42501: permission denied for table request', 'the worker still reads no request row directly');

-- 2. One request in every state, some fresh and some stale, written by the
-- test's own role (the owner's policy would pass them the same).
CREATE TEMP TABLE conv172 ON COMMIT DROP AS
WITH c AS (INSERT INTO assistant.conversation (institution_id, student_id, assignment_id)
           VALUES (pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1')) RETURNING id)
SELECT id FROM c;
INSERT INTO assistant.request (institution_id, student_id, assignment_id, assignment_version, conversation_id,
  idempotency_key, request_sha256, purpose_catalog_version, purpose_key, provider_id, model_id, config_version, state,
  reason, requested_at, sent_at, finished_at)
SELECT pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), 1, (SELECT id FROM conv172), pg_temp.key(s.n),
       repeat('c', 64), 1, 'proofreading', 'provider-test-a', 'model-test-1', 'test-1', s.state, s.reason,
       now() - s.age,
       CASE WHEN s.state <> 'reserved' AND s.state <> 'rejected' THEN now() - s.age END,
       CASE WHEN s.state IN ('rejected', 'completed', 'provider_failed', 'settled') THEN now() - s.age END
FROM (VALUES (1, 'reserved', NULL, interval '6 minutes'),
             (2, 'reserved', NULL, interval '4 minutes'),
             (3, 'sent', NULL, interval '11 minutes'),
             (4, 'sent', NULL, interval '9 minutes'),
             (5, 'outcome_unknown', NULL, interval '1 minute'),
             (6, 'outcome_unknown', NULL, interval '2 days'),
             (7, 'rejected', 'budget_exceeded', interval '1 hour'),
             (8, 'completed', NULL, interval '1 hour'),
             (9, 'provider_failed', 'provider_failed', interval '1 hour'),
             (10, 'settled', NULL, interval '1 hour')) AS s (n, state, reason, age);
INSERT INTO assistant.cost_ledger (request_id, institution_id, student_id, assignment_id, budget_day,
  institution_cap_period_start, service_cap_period_start, reserved_micro, state, reserved_at)
SELECT r.id, r.institution_id, r.student_id, r.assignment_id, assistant.budget_day(r.requested_at),
       assistant.budget_day(r.requested_at), date_trunc('month', assistant.budget_day(r.requested_at))::date, 7,
       'reserved', r.requested_at
  FROM assistant.request r
 WHERE r.student_id = pg_temp.id('ana') AND r.state IN ('reserved', 'sent', 'outcome_unknown')
   AND r.idempotency_key IN (SELECT pg_temp.key(n) FROM generate_series(1, 10) AS n);

SELECT is(pg_temp.due(), '006,003,001,005',
  'listed: the stale reservation, the stale sent request and both outcome_unknown, oldest request first');
SELECT is(pg_temp.due(2), '006,003', 'the bound takes the oldest');
SELECT is(pg_temp.due(1000), '006,003,001,005', 'a thousand is the largest bound');
SELECT is(pg_temp.due(b.n), 'ZD422: invalid input', 'a bound of ' || coalesce(b.n::text, 'NULL') || ' is invalid')
FROM (VALUES (0), (-1), (1001), (NULL::integer)) AS b (n);

-- 3. The sweep of every listed id empties the listing; a second run changes nothing.
SELECT is(pg_temp.ask_as('ductus_worker', 'anon', format('SELECT assistant.sweep_and_settle(%L)', pg_temp.rid(s.n))),
          s.state, 'the sweep of ' || s.n || ' gives ' || s.state)
FROM (VALUES (6, 'settled'), (3, 'settled'), (1, 'rejected'), (5, 'settled')) AS s (n, state);
SELECT is(pg_temp.due(), '', 'after the sweep nothing of this file is listed');
SELECT is((SELECT string_agg(right(r.idempotency_key::text, 3) || ':' || r.state || ':' || l.state, ','
                             ORDER BY r.idempotency_key)
             FROM assistant.request r JOIN assistant.cost_ledger l ON l.request_id = r.id
            WHERE r.student_id = pg_temp.id('ana') AND r.idempotency_key IN (SELECT pg_temp.key(n) FROM generate_series(1, 10) AS n)),
  '001:rejected:released,002:reserved:reserved,003:settled:settled,004:sent:reserved,005:settled:settled,006:settled:settled',
  'released or settled once each; the fresh reservation and the fresh sent request untouched');
SELECT is(pg_temp.ask_as('ductus_worker', 'anon', format('SELECT assistant.sweep_and_settle(%L)', pg_temp.rid(6))),
  'settled', 'a second sweep of a settled request answers the same');
SELECT is((SELECT actual_micro FROM assistant.cost_ledger WHERE request_id = pg_temp.rid(6)), 7::bigint,
  'settled once, at the reservation (no query of the actual cost until OA-1)');

SELECT * FROM finish();
ROLLBACK;
