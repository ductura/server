-- SRV-1202 (Val 12 / M9.0-S2, Ductus#2051): the schema assistant
-- (20261122100000), step 2 of Ductus docs/contracts/ai-request-v1.md; plan of
-- attack Ductus#1662 (M1 to M7, G1, G2, G7). No RPC exists yet, so every row
-- below is written by the owner role, as the RPCs of SRV-1203 will.
--
--   1. catalogue: six tables and no table of provider keys, owner, forced RLS,
--      policies, privileges, columns and their classes, trigger functions;
--   2. checks: closed sets, keys, amounts, content and its hash;
--   3. the access matrix: every "ne" cell of the contract is a refusal here,
--      for the student owner (Ana), another student of the same course (Dora),
--      the teacher of the course (Vesna), a teacher of another course (Marko),
--      a teacher of another institution (Petra), the administrator (Iva), the
--      worker and the operator; another student's id and an id that does not
--      exist give the same outcome (M4, M5);
--   4. no direct write by the web role or the worker (M1, M2);
--   5. triggers: message append-only, conversation never deleted (G7), request
--      transitions (R1), settled and released ledger rows frozen (M7),
--      configuration append-only without gaps.
--
-- The operator (and support) has no account and no runtime role of its own
-- yet (owner action V-7): its cells are held by every runtime role that is
-- not the web process or the worker, and by a session without a relation
-- (Boris). Every person, text, provider and model below is invented; the
-- providers and models are provider-test-a and model-test-1 (S4).
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

INSERT INTO ref VALUES
  ('conv_a', '00000000-0000-4000-8000-0000000017a1'),
  ('conv_t', '00000000-0000-4000-8000-0000000017a2'),
  ('r1', '00000000-0000-4000-8000-0000000017b1'),
  ('r2', '00000000-0000-4000-8000-0000000017b2'),
  ('r3', '00000000-0000-4000-8000-0000000017b3'),
  ('r4', '00000000-0000-4000-8000-0000000017b4'),
  ('m1', '00000000-0000-4000-8000-0000000017c1'),
  ('m2', '00000000-0000-4000-8000-0000000017c2'),
  ('m3', '00000000-0000-4000-8000-0000000017c3'),
  ('operator', '00000000-0000-4000-8000-0000000017d1');

CREATE FUNCTION pg_temp.sha(p_body text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_body, 'UTF8')), 'hex')
$$;
-- Runs one statement as the owner role and returns 'ok' or the SQLSTATE; a
-- failed statement leaves nothing behind.
CREATE FUNCTION pg_temp.own(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text := 'ok';
BEGIN
  SET LOCAL ROLE ductus_identity;
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v := SQLSTATE;
  END;
  RESET ROLE;
  RETURN v;
END
$$;

-- The trail check of the configuration (SRV-1203, M6) is 171's: here the
-- versions are written without their trail rows, so it is off until the
-- controls at the end, and no deferred event holds a TRUNCATE or ALTER back.
ALTER TABLE assistant.cost_config_version DISABLE TRIGGER cost_config_version_has_event;

-- Rows of the owner, as the RPCs will write them. Ana's request r1 runs to
-- completed, r2 is refused before any conversation, r4 is reserved; Tomo's r3
-- in the other institution is sent.
SET LOCAL ROLE ductus_identity;
INSERT INTO assistant.conversation (id, institution_id, student_id, assignment_id) VALUES
  (pg_temp.id('conv_a'), pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1')),
  (pg_temp.id('conv_t'), pg_temp.id('fak_b'), pg_temp.id('tomo'), pg_temp.id('z3'));
INSERT INTO assistant.request (id, institution_id, student_id, assignment_id, assignment_version, conversation_id,
  idempotency_key, request_sha256, purpose_catalog_version, purpose_key, provider_id, model_id, config_version,
  state, reason, finished_at) VALUES
  (pg_temp.id('r1'), pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), 2, pg_temp.id('conv_a'),
   '00000000-0000-4000-8000-0000000017e1', pg_temp.sha('r1'), 1, 'proofreading', 'provider-test-a', 'model-test-1',
   'test-1', 'reserved', NULL, NULL),
  (pg_temp.id('r2'), pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), 2, NULL,
   '00000000-0000-4000-8000-0000000017e2', pg_temp.sha('r2'), 1, 'translation', NULL, NULL, NULL,
   'rejected', 'ai_disabled', now()),
  (pg_temp.id('r3'), pg_temp.id('fak_b'), pg_temp.id('tomo'), pg_temp.id('z3'), 1, pg_temp.id('conv_t'),
   '00000000-0000-4000-8000-0000000017e1', pg_temp.sha('r3'), 1, 'translation', 'provider-test-a', 'model-test-1',
   'test-1', 'reserved', NULL, NULL),
  (pg_temp.id('r4'), pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), 2, pg_temp.id('conv_a'),
   '00000000-0000-4000-8000-0000000017e4', pg_temp.sha('r4'), 1, 'proofreading', 'provider-test-a', 'model-test-1',
   'test-1', 'reserved', NULL, NULL);
INSERT INTO assistant.message (id, conversation_id, institution_id, seq, request_id, role, content, content_sha256) VALUES
  (pg_temp.id('m1'), pg_temp.id('conv_a'), pg_temp.id('fak_a'), 1, pg_temp.id('r1'), 'student_paragraph',
   'Izmišljeni odlomak o kišobranima na tramvajskoj stanici.', pg_temp.sha('Izmišljeni odlomak o kišobranima na tramvajskoj stanici.')),
  (pg_temp.id('m3'), pg_temp.id('conv_t'), pg_temp.id('fak_b'), 1, pg_temp.id('r3'), 'student_paragraph',
   'Drugi izmišljeni odlomak, druge ustanove.', pg_temp.sha('Drugi izmišljeni odlomak, druge ustanove.'));
INSERT INTO assistant.cost_ledger (request_id, institution_id, student_id, assignment_id, budget_day,
  institution_cap_period_start, service_cap_period_start, reserved_micro, state) VALUES
  (pg_temp.id('r1'), pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), '2026-11-22', '2026-11-01', '2026-11-01', 7, 'reserved'),
  (pg_temp.id('r3'), pg_temp.id('fak_b'), pg_temp.id('tomo'), pg_temp.id('z3'), '2026-11-22', '2026-11-22', '2026-11-01', 7, 'reserved'),
  (pg_temp.id('r4'), pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), '2026-11-22', '2026-11-01', '2026-11-01', 7, 'reserved');
INSERT INTO assistant.budget_counter (scope, scope_key, institution_id, period_start, used_micro) VALUES
  ('service_cap', '', NULL, '2026-11-01', 21),
  ('institution_cap', pg_temp.id('fak_a')::text, pg_temp.id('fak_a'), '2026-11-01', 14),
  ('student_day', pg_temp.id('fak_a') || ':' || pg_temp.id('ana'), pg_temp.id('fak_a'), '2026-11-22', 14),
  ('student_assignment_day', pg_temp.id('fak_a') || ':' || pg_temp.id('ana') || ':' || pg_temp.id('z1'), pg_temp.id('fak_a'), '2026-11-22', 14);
INSERT INTO assistant.cost_config_version (institution_id, version_no, cap_micro, cap_period, published_by) VALUES
  (NULL, 1, 1000, 'month', pg_temp.id('operator'));
INSERT INTO assistant.cost_config_version (institution_id, version_no, cap_micro, cap_period, student_day_micro,
  student_assignment_day_micro, reserve_micro, published_by) VALUES
  (pg_temp.id('fak_a'), 1, 100, 'day', 20, 10, 7, pg_temp.id('iva'));
-- r1 runs on to completed with its response and is settled; r3 is sent.
UPDATE assistant.request SET state = 'sent', sent_at = now() WHERE id IN (pg_temp.id('r1'), pg_temp.id('r3'));
UPDATE assistant.request SET state = 'completed', finished_at = now() WHERE id = pg_temp.id('r1');
INSERT INTO assistant.message (id, conversation_id, institution_id, seq, request_id, role, content, content_sha256) VALUES
  (pg_temp.id('m2'), pg_temp.id('conv_a'), pg_temp.id('fak_a'), 2, pg_temp.id('r1'), 'provider_response',
   'Izmišljeni odgovor sintetičkog pružatelja.', pg_temp.sha('Izmišljeni odgovor sintetičkog pružatelja.'));
UPDATE assistant.cost_ledger SET state = 'settled', actual_micro = 5, settled_at = now() WHERE request_id = pg_temp.id('r1');
RESET ROLE;

-- 1. Catalogue.
SELECT is(pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname = 'assistant'))::text, 'ductus_migrator',
  'the migrator owns the schema assistant');
SELECT bag_eq(
  $$ SELECT relname::text FROM pg_class WHERE relnamespace = 'assistant'::regnamespace AND relkind IN ('r', 'p', 'v', 'm', 'f') $$,
  $$ VALUES ('conversation'), ('message'), ('request'), ('cost_ledger'), ('budget_counter'), ('cost_config_version') $$,
  'the schema holds exactly the six tables of the contract: no table of provider keys (OA-1, M8)');
SELECT is_empty(
  $$ SELECT relname FROM pg_class WHERE relnamespace = 'assistant'::regnamespace AND relkind = 'r'
      AND NOT (relrowsecurity AND relforcerowsecurity AND relowner = 'ductus_identity'::regrole) $$,
  'every table has ENABLE and FORCE ROW LEVEL SECURITY and belongs to ductus_identity');
SELECT is_empty(
  $$ SELECT attrelid::regclass || '.' || attname FROM pg_attribute
      WHERE attrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'assistant'::regnamespace AND relkind = 'r')
        AND attnum > 0 AND NOT attisdropped
        AND (attname ~ '(secret|api_key|token|password|credential)') $$,
  'no column holds a provider secret (L5 does not appear)');
SELECT bag_eq(
  $$ SELECT tablename || ' ' || policyname || ' ' || roles::text || ' ' || cmd FROM pg_policies WHERE schemaname = 'assistant' $$,
  $$ VALUES ('conversation conversation_owner {ductus_identity} ALL'),
            ('message message_owner {ductus_identity} ALL'),
            ('request request_owner {ductus_identity} ALL'),
            ('cost_ledger cost_ledger_owner {ductus_identity} ALL'),
            ('budget_counter budget_counter_owner {ductus_identity} ALL'),
            ('cost_config_version cost_config_version_owner {ductus_identity} ALL'),
            ('conversation conversation_student_read {ductus_app} SELECT'),
            ('message message_student_read {ductus_app} SELECT'),
            ('request request_student_read {ductus_app} SELECT') $$,
  'the owner policy on every table and reading for the student on three; no policy for another role');
-- Every privilege of every runtime role and PUBLIC, table or column level.
SELECT bag_eq(
  $$ SELECT r.rolname || ' ' || p.privilege || ' ' || c.relname
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname <> 'ductus_identity'
           UNION ALL SELECT 'ductus_test_stranger' UNION ALL SELECT 'public') AS r
     CROSS JOIN pg_class c
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p (privilege)
     WHERE c.relnamespace = 'assistant'::regnamespace AND c.relkind = 'r'
       AND (has_table_privilege(r.rolname, c.oid, p.privilege)
            OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                AND has_any_column_privilege(r.rolname, c.oid, p.privilege))) $$,
  $$ VALUES ('ductus_app SELECT conversation'), ('ductus_app SELECT message'), ('ductus_app SELECT request') $$,
  'the web role reads three tables; no runtime role writes, none reads the ledger, counters or configuration');
SELECT bag_eq(
  $$ SELECT p.proname::text || ' ' || pg_get_userbyid(p.proowner) || ' ' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
      FROM pg_proc p WHERE p.pronamespace = 'assistant'::regnamespace $$,
  $$ VALUES ('refuse_change ductus_identity false search_path=""'),
            ('guard_request_transition ductus_identity false search_path=""'),
            ('guard_ledger_change ductus_identity false search_path=""'),
            ('guard_config_version ductus_identity false search_path=""'),
            -- SRV-1203: the RPCs and their helpers; 171 tests them.
            ('check_config_event ductus_identity false search_path=""'),
            ('check_config_version_event ductus_identity true search_path=""'),
            ('stale_reserved_after ductus_identity false search_path=""'),
            ('stale_sent_after ductus_identity false search_path=""'),
            ('max_paragraph_code_points ductus_identity false search_path=""'),
            ('budget_day ductus_identity false search_path=""'),
            ('period_start ductus_identity false search_path=""'),
            ('is_paragraph ductus_identity false search_path=""'),
            ('request_sha256 ductus_identity false search_path=""'),
            ('policy_allows ductus_identity false search_path=""'),
            ('move_counters ductus_identity false search_path=""'),
            ('close_ledger ductus_identity false search_path=""'),
            ('own_request ductus_identity false search_path=""'),
            ('begin_request ductus_identity true search_path=""'),
            ('mark_sent ductus_identity true search_path=""'),
            ('complete_request ductus_identity true search_path=""'),
            ('fail_request ductus_identity true search_path=""'),
            ('mark_outcome_unknown ductus_identity true search_path=""'),
            ('sweep_and_settle ductus_identity true search_path=""'),
            ('read_conversation ductus_identity true search_path=""'),
            ('write_config_version ductus_identity false search_path=""'),
            ('latest_config ductus_identity false search_path=""'),
            ('publish_cost_config ductus_identity true search_path=""'),
            ('publish_cost_cap ductus_identity false search_path=""'),
            -- SRV-1205: the worker's listing of due requests; 172 tests it.
            ('sweep_due ductus_identity true search_path=""') $$,
  'the schema has four trigger functions and, since SRV-1203 and SRV-1205, the RPCs and their helpers');
SELECT bag_eq(
  $$ SELECT r || ' ' || p.oid::regprocedure FROM pg_proc p
      CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence',
                              'ductus_test_stranger', 'public']) AS r
      WHERE p.pronamespace = 'assistant'::regnamespace AND has_function_privilege(r, p.oid, 'EXECUTE') $$,
  $$ VALUES ('ductus_app assistant.begin_request(uuid,uuid,uuid,integer,text,text,text,text,text)'),
            ('ductus_app assistant.mark_sent(uuid)'), ('ductus_app assistant.complete_request(uuid,text,bigint)'),
            ('ductus_app assistant.fail_request(uuid,text,bigint)'), ('ductus_app assistant.mark_outcome_unknown(uuid)'),
            ('ductus_app assistant.read_conversation(uuid)'),
            ('ductus_app assistant.publish_cost_config(integer,bigint,bigint,bigint)'),
            ('ductus_worker assistant.sweep_and_settle(uuid)'), ('ductus_worker assistant.sweep_due(integer)') $$,
  'a runtime role executes only the RPCs meant for it: the web role seven, the worker the sweep and its listing (SRV-1205)');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'assistant', 'CREATE'),
  'after the migration the identity role keeps no CREATE on the schema');
SELECT bag_eq(
  $$ SELECT r || ' ' || has_schema_privilege(r, 'assistant', 'USAGE')
      FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence',
                        'ductus_test_stranger']) AS r $$,
  $$ VALUES ('ductus_app true'), ('ductus_worker true'), ('ductus_retention false'), ('ductus_auth false'),
            ('ductus_evidence false'), ('ductus_test_stranger false') $$,
  'only the web role and, for its RPC (SRV-1203), the worker use the schema');
SELECT bag_eq(
  $$ SELECT c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'assistant'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped $$,
  $$ VALUES
    ('conversation.id uuid not null'), ('conversation.institution_id uuid not null'), ('conversation.student_id uuid not null'),
    ('conversation.assignment_id uuid not null'), ('conversation.created_at timestamp with time zone not null'),
    ('message.id uuid not null'), ('message.conversation_id uuid not null'), ('message.institution_id uuid not null'),
    ('message.seq integer not null'),
    ('message.request_id uuid not null'), ('message.role text not null'), ('message.content text not null'),
    ('message.content_sha256 text not null'), ('message.created_at timestamp with time zone not null'),
    ('request.id uuid not null'), ('request.institution_id uuid not null'), ('request.student_id uuid not null'),
    ('request.assignment_id uuid not null'), ('request.assignment_version integer not null'), ('request.conversation_id uuid'),
    ('request.idempotency_key uuid not null'), ('request.request_sha256 text not null'),
    ('request.purpose_catalog_version integer not null'), ('request.purpose_key text not null'),
    ('request.provider_id text'), ('request.model_id text'), ('request.config_version text'),
    ('request.state text not null'), ('request.reason text'), ('request.requested_at timestamp with time zone not null'),
    ('request.sent_at timestamp with time zone'), ('request.finished_at timestamp with time zone'),
    ('cost_ledger.request_id uuid not null'), ('cost_ledger.institution_id uuid not null'),
    ('cost_ledger.student_id uuid not null'), ('cost_ledger.assignment_id uuid not null'),
    ('cost_ledger.budget_day date not null'), ('cost_ledger.institution_cap_period_start date not null'),
    ('cost_ledger.service_cap_period_start date not null'), ('cost_ledger.reserved_micro bigint not null'),
    ('cost_ledger.actual_micro bigint'), ('cost_ledger.state text not null'),
    ('cost_ledger.reserved_at timestamp with time zone not null'), ('cost_ledger.settled_at timestamp with time zone'),
    ('budget_counter.scope text not null'), ('budget_counter.scope_key text not null'), ('budget_counter.institution_id uuid'),
    ('budget_counter.period_start date not null'), ('budget_counter.used_micro bigint not null'),
    ('cost_config_version.id uuid not null'), ('cost_config_version.institution_id uuid'),
    ('cost_config_version.version_no integer not null'), ('cost_config_version.cap_micro bigint'),
    ('cost_config_version.cap_period text not null'), ('cost_config_version.student_day_micro bigint'),
    ('cost_config_version.student_assignment_day_micro bigint'), ('cost_config_version.reserve_micro bigint'),
    ('cost_config_version.published_by uuid'), ('cost_config_version.published_at timestamp with time zone not null') $$,
  'the columns and types of the contract, with institution_id on every table; every amount is bigint micro-euros');
SELECT is_empty(
  $$ SELECT c.relname || '.' || a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'assistant'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
        AND c.relname IN ('request', 'conversation') AND a.attname ~ '(content|paragraph|response|micro|title|summary)' $$,
  'L1 tables carry no content (L2) and no amount (L3); a conversation has no title or summary');
SELECT bag_eq(
  $$ SELECT conrelid::regclass::text || ' ' || pg_get_constraintdef(oid) FROM pg_constraint
      WHERE connamespace = 'assistant'::regnamespace AND contype IN ('u', 'p') $$,
  $$ VALUES
    ('assistant.conversation PRIMARY KEY (id)'),
    ('assistant.conversation UNIQUE (id, institution_id)'),
    ('assistant.conversation UNIQUE (id, institution_id, student_id, assignment_id)'),
    ('assistant.request PRIMARY KEY (id)'),
    ('assistant.request UNIQUE (student_id, idempotency_key)'),
    ('assistant.request UNIQUE (id, conversation_id, institution_id)'),
    ('assistant.request UNIQUE (id, institution_id, student_id, assignment_id)'),
    ('assistant.message PRIMARY KEY (id)'),
    ('assistant.message UNIQUE (conversation_id, seq)'),
    ('assistant.message UNIQUE (request_id, role)'),
    ('assistant.cost_ledger PRIMARY KEY (request_id)'),
    ('assistant.budget_counter PRIMARY KEY (scope, scope_key, period_start)'),
    ('assistant.cost_config_version PRIMARY KEY (id)'),
    ('assistant.cost_config_version UNIQUE NULLS NOT DISTINCT (institution_id, version_no)'),
    ('assistant.cost_config_version UNIQUE (id, institution_id)') $$,
  'the keys: one seq per conversation, one idempotency key per student, one ledger row per request');

-- 2. Checks. Each refused row writes nothing.
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.message (conversation_id, institution_id, seq, request_id, role, content, content_sha256)
    VALUES (%L, '00000000-0000-4000-8000-00000000000a', 2, %L, 'student_paragraph', 'Tekst.', %L) $$, pg_temp.id('conv_a'), pg_temp.id('r4'), pg_temp.sha('Tekst.'))),
  '23505', 'a second message with the same seq in one conversation is refused');
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.message (conversation_id, institution_id, seq, request_id, role, content, content_sha256)
    VALUES (%L, '00000000-0000-4000-8000-00000000000a', 3, %L, 'student_paragraph', 'Tekst.', %L) $$, pg_temp.id('conv_a'), pg_temp.id('r1'), pg_temp.sha('Tekst.'))),
  '23505', 'a second paragraph of the same request is refused');
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.message (conversation_id, institution_id, seq, request_id, role, content, content_sha256)
    VALUES (%L, '00000000-0000-4000-8000-00000000000a', 3, %L, 'provider_response', 'Tekst.', %L) $$, pg_temp.id('conv_a'), pg_temp.id('r3'), pg_temp.sha('Tekst.'))),
  '23503', 'a message cannot join a conversation that is not its request''s');
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.message (conversation_id, institution_id, seq, request_id, role, content, content_sha256)
    VALUES (%L, '00000000-0000-4000-8000-00000000000a', 3, %L, %L, %L, %L) $$, pg_temp.id('conv_a'), pg_temp.id('r4'), m.role, m.content, m.sha)),
  m.outcome, 'a message ' || m.why)
FROM (VALUES
  ('system', 'Tekst.', pg_temp.sha('Tekst.'), '23514', 'with a role outside the closed set is refused'),
  ('student_paragraph', '', pg_temp.sha(''), '23514', 'that is empty is refused'),
  ('student_paragraph', repeat('a', 40001), pg_temp.sha(repeat('a', 40001)), '23514', 'over the outer bound is refused'),
  ('student_paragraph', E'Kafé.', pg_temp.sha(E'Kafé.'), '23514', 'that is not NFC is refused'),
  ('student_paragraph', 'Tekst.', pg_temp.sha('Drugi tekst.'), '23514', 'whose hash is not the SHA-256 of its content is refused'),
  ('student_paragraph', 'Tekst.', upper(pg_temp.sha('Tekst.')), '23514', 'with an upper-case hash is refused')
) AS m (role, content, sha, outcome, why);

CREATE FUNCTION pg_temp.req(p_student text, p_key text, p_state text, p_reason text, p_extra text DEFAULT '') RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.own(format($q$ INSERT INTO assistant.request (institution_id, student_id, assignment_id, assignment_version,
      conversation_id, idempotency_key, request_sha256, purpose_catalog_version, purpose_key, provider_id, model_id,
      config_version, state, reason, sent_at, finished_at)
    SELECT p.institution_id, p.id, %L, %s, %s, %L, %L, 1, 'proofreading', 'provider-test-a', 'model-test-1', 'test-1',
      %L, %L, %s, %s FROM person p WHERE p.name = %L $q$,
    CASE p_student WHEN 'tomo' THEN pg_temp.id('z3') ELSE pg_temp.id('z1') END,
    CASE p_student WHEN 'tomo' THEN '1' ELSE '2' END,
    CASE p_student WHEN 'ana' THEN quote_literal(pg_temp.id('conv_a')) WHEN 'tomo' THEN quote_literal(pg_temp.id('conv_t')) ELSE 'NULL' END,
    p_key, pg_temp.sha(p_key), p_state, p_reason,
    CASE WHEN p_state IN ('sent', 'completed', 'provider_failed', 'outcome_unknown', 'settled') THEN 'now()' ELSE 'NULL' END,
    CASE WHEN p_state IN ('rejected', 'completed', 'provider_failed', 'settled') THEN 'now()' ELSE 'NULL' END,
    p_student) || p_extra)
$$;
SELECT is(pg_temp.req('ana', '00000000-0000-4000-8000-0000000017e1', 'reserved', NULL), '23505',
  'the same idempotency key of the same student is refused');
SELECT is(pg_temp.req('dora', '00000000-0000-4000-8000-0000000017e1', 'rejected', 'budget_exceeded'), 'ok',
  'the same key of another student is another request');
SELECT is(pg_temp.req('ana', '00000000-0000-4000-8000-0000000017f1', s.state, s.reason), s.outcome,
  'a request in state ' || coalesce(s.state, 'null') || ' with reason ' || coalesce(s.reason, 'null') || ': ' || s.outcome)
FROM (VALUES
  ('pending', NULL, '23514'), ('rejected', NULL, '23514'), ('rejected', 'quota', '23514'),
  ('reserved', 'budget_exceeded', '23514'), ('completed', 'completed', '23514'), ('provider_failed', NULL, '23514')
) AS s (state, reason, outcome);
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.request (institution_id, student_id, assignment_id, assignment_version,
    idempotency_key, request_sha256, purpose_catalog_version, purpose_key, state) VALUES (%L, %L, %L, 2, %L, %L, 1, 'proofreading', 'reserved') $$,
    pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), '00000000-0000-4000-8000-0000000017f2', pg_temp.sha('x'))),
  '23514', 'a request without a conversation, provider or model is refused unless it is rejected');
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.request (institution_id, student_id, assignment_id, assignment_version,
    conversation_id, idempotency_key, request_sha256, purpose_catalog_version, purpose_key, state, reason, finished_at)
    VALUES (%L, %L, %L, 2, %L, %L, %L, 1, 'proofreading', 'rejected', 'forbidden', now()) $$,
    pg_temp.id('fak_a'), pg_temp.id('dora'), pg_temp.id('z1'), pg_temp.id('conv_a'), '00000000-0000-4000-8000-0000000017f3', pg_temp.sha('x'))),
  '23503', 'a request cannot point at another student''s conversation');
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.request (institution_id, student_id, assignment_id, assignment_version,
    idempotency_key, request_sha256, purpose_catalog_version, purpose_key, state, reason, finished_at)
    VALUES (%L, %L, %L, 9, %L, %L, 1, 'proofreading', 'rejected', 'forbidden', now()) $$,
    pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), '00000000-0000-4000-8000-0000000017f4', pg_temp.sha('x'))),
  '23503', 'a request names an assignment version that exists');
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.request (institution_id, student_id, assignment_id, assignment_version,
    idempotency_key, request_sha256, purpose_catalog_version, purpose_key, provider_id, state, reason, finished_at)
    VALUES (%L, %L, %L, 2, %L, %L, 1, 'proofreading', %L, 'rejected', 'forbidden', now()) $$,
    pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), '00000000-0000-4000-8000-0000000017f5', pg_temp.sha('x'), p.v)),
  '23514', 'a provider id of a wrong shape is refused: ' || p.v)
FROM (VALUES ('Provider-Test-A'), ('-provider'), ('provider test')) AS p (v);
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.request (institution_id, student_id, assignment_id, assignment_version,
    idempotency_key, request_sha256, purpose_catalog_version, purpose_key, state, reason, finished_at)
    VALUES (%L, %L, %L, 2, %L, 'abc', 1, 'proofreading', 'rejected', 'forbidden', now()) $$,
    pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'), '00000000-0000-4000-8000-0000000017f6')),
  '23514', 'a request hash that is not 64 hex characters is refused');

-- The ledger: amounts in whole micro-euros, a closed set of states.
CREATE FUNCTION pg_temp.ledger(p_reserved text, p_actual text, p_state text, p_settled text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.own(format($q$ INSERT INTO assistant.cost_ledger (request_id, institution_id, student_id, assignment_id,
      budget_day, institution_cap_period_start, service_cap_period_start, reserved_micro, actual_micro, state, settled_at)
    SELECT r.id, r.institution_id, r.student_id, r.assignment_id, '2026-11-22', '2026-11-01', '2026-11-01', %s, %s, %L, %s
      FROM assistant.request r WHERE r.id = %L $q$, p_reserved, p_actual, p_state, p_settled, pg_temp.id('r2')))
$$;
SELECT is(pg_temp.ledger(l.reserved, l.actual, l.state, l.settled), l.outcome, 'a ledger row ' || l.why)
FROM (VALUES
  ('0', 'NULL', 'reserved', 'NULL', '23514', 'with nothing reserved is refused'),
  ('-1', 'NULL', 'reserved', 'NULL', '23514', 'with a negative reservation is refused'),
  ($$'1.5'$$, 'NULL', 'reserved', 'NULL', '22P02', 'with a fraction of a micro-euro is refused'),
  ('7', '-1', 'settled', 'now()', '23514', 'settled below zero is refused'),
  ('7', 'NULL', 'settled', 'now()', '23514', 'settled without an amount is refused'),
  ('7', '3', 'released', 'now()', '23514', 'released with an amount is refused'),
  ('7', 'NULL', 'pending', 'NULL', '23514', 'in a state outside the closed set is refused'),
  ('7', 'NULL', 'reserved', 'now()', '23514', 'reserved with a settling time is refused')
) AS l (reserved, actual, state, settled, outcome, why);
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.cost_ledger (request_id, institution_id, student_id, assignment_id,
    budget_day, institution_cap_period_start, service_cap_period_start, reserved_micro, state)
    VALUES (%L, %L, %L, %L, '2026-11-22', '2026-11-01', '2026-11-01', 7, 'reserved') $$,
    pg_temp.id('r1'), pg_temp.id('fak_a'), pg_temp.id('ana'), pg_temp.id('z1'))),
  '23505', 'one ledger row per request');
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.cost_ledger (request_id, institution_id, student_id, assignment_id,
    budget_day, institution_cap_period_start, service_cap_period_start, reserved_micro, state)
    VALUES (%L, %L, %L, %L, '2026-11-22', '2026-11-01', '2026-11-01', 7, 'reserved') $$,
    pg_temp.id('r2'), pg_temp.id('fak_a'), pg_temp.id('dora'), pg_temp.id('z1'))),
  '23503', 'a ledger row copies the student of its request');

-- Counters: a closed set of scopes and the shape of their keys.
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.budget_counter (scope, scope_key, institution_id, period_start, used_micro) VALUES (%L, %L, %s, '2026-11-23', %s) $$,
    c.scope, c.scope_key, c.inst, c.used)), c.outcome, 'a counter ' || c.why)
FROM (VALUES
  ('student_week', pg_temp.id('fak_a')::text, quote_literal(pg_temp.id('fak_a')), '0', '23514', 'with a scope outside the closed set is refused'),
  ('service_cap', pg_temp.id('fak_a')::text, 'NULL', '0', '23514', 'of the whole service with a key is refused'),
  ('service_cap', '', quote_literal(pg_temp.id('fak_a')), '0', '23514', 'of the whole service with an institution is refused'),
  ('institution_cap', '', quote_literal(pg_temp.id('fak_a')), '0', '23514', 'of an institution without a key is refused'),
  ('institution_cap', pg_temp.id('fak_a')::text, 'NULL', '0', '23514', 'of an institution without its institution is refused'),
  ('institution_cap', pg_temp.id('fak_a')::text, quote_literal(pg_temp.id('fak_b')), '0', '23514', 'whose key names another institution is refused'),
  ('student_day', pg_temp.id('ana')::text, quote_literal(pg_temp.id('fak_a')), '0', '23514', 'of a student without the institution is refused'),
  ('institution_cap', pg_temp.id('fak_a')::text, quote_literal(pg_temp.id('fak_a')), '-1', '23514', 'below zero is refused'),
  ('institution_cap', pg_temp.id('fak_a')::text, quote_literal(pg_temp.id('fak_a')), '0', 'ok', 'of an institution in a new period is written')
) AS c (scope, scope_key, inst, used, outcome, why);

-- Configuration: a closed set of periods; student limits only for an institution.
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.cost_config_version (institution_id, version_no, cap_micro, cap_period,
    student_day_micro, reserve_micro, published_by) VALUES (%s, 2, 10, %L, %s, %s, %L) $$,
    c.inst, c.period, c.student_day, c.reserve, c.publisher)), c.outcome, 'a configuration ' || c.why)
FROM (VALUES
  ('NULL', 'week', 'NULL', 'NULL', pg_temp.id('operator'), '23514', 'with a period outside day and month is refused'),
  ('NULL', 'day', '5', 'NULL', pg_temp.id('operator'), '23514', 'of the service with a student limit is refused'),
  ('NULL', 'day', 'NULL', '3', pg_temp.id('operator'), '23514', 'of the service with a reservation is refused'),
  (quote_literal(pg_temp.id('fak_a')), 'day', '5', '0', pg_temp.id('iva'), '23514', 'with a reservation of zero is refused'),
  (quote_literal(pg_temp.id('fak_a')), 'day', '5', '3', pg_temp.id('lea'), '23503', 'published by an account of another institution is refused')
) AS c (inst, period, student_day, reserve, publisher, outcome, why);

-- 3. The access matrix (contract, "Matrica pristupa"). Each cell reads a
-- table through the web process with the actor's session; a refusal is either
-- no row or no privilege at all.
CREATE FUNCTION pg_temp.reads(p_role text, p_actor text, p_table text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text := pg_temp.ask_as(p_role, p_actor, format('SELECT count(*)::text FROM assistant.%I', p_table));
BEGIN
  RETURN CASE
    WHEN v LIKE '42501: permission denied for schema %' THEN 'no schema privilege'
    WHEN v LIKE '42501: permission denied for table %' THEN 'no privilege'
    ELSE v END;
END
$$;
CREATE TEMP TABLE matrix (actor text, conversation text, message text, request text, cost_ledger text,
                          budget_counter text, cost_config_version text);
INSERT INTO matrix VALUES
  -- Student owner: own conversation, its two messages, own requests (r1, r2,
  -- r4); the own spend comes through an RPC of a later step, never the rows.
  ('ana', '1', '2', '3', 'no privilege', 'no privilege', 'no privilege'),
  ('dora', '0', '0', '1', 'no privilege', 'no privilege', 'no privilege'),
  ('vesna', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  ('marko', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  ('nina', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  ('petra', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  -- Administrator: the sum of the institution and the own configuration come
  -- through RPCs of a later step (OA-5); no row is read directly.
  ('iva', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  ('lea', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  ('boris', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  -- Tomo owns the conversation and the request of the other institution.
  ('tomo', '1', '1', '1', 'no privilege', 'no privilege', 'no privilege'),
  ('expired', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  ('closed', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  ('unknown', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege'),
  ('anon', '0', '0', '0', 'no privilege', 'no privilege', 'no privilege');
SELECT is(pg_temp.reads('ductus_app', m.actor, t.tbl), t.expected, format('%s reads %s: %s', m.actor, t.tbl, t.expected))
FROM matrix m
CROSS JOIN LATERAL (VALUES ('conversation', m.conversation), ('message', m.message), ('request', m.request),
  ('cost_ledger', m.cost_ledger), ('budget_counter', m.budget_counter), ('cost_config_version', m.cost_config_version)
) AS t (tbl, expected);
-- Dora's one request is the refused one written in 2 with Ana's key.
SELECT is(pg_temp.ask('dora', 'SELECT string_agg(state, '','') FROM assistant.request'), 'rejected',
  'Dora reads only her own request, never Ana''s with the same key');
SELECT is(pg_temp.ask('ana', $$ SELECT string_agg(seq || ':' || role, ',' ORDER BY seq) FROM assistant.message $$),
  '1:student_paragraph,2:provider_response', 'Ana reads her two messages in order');
SELECT is(pg_temp.ask('ana', $$ SELECT string_agg(r.state, ',' ORDER BY r.state) FROM assistant.request r $$),
  'completed,rejected,reserved', 'Ana reads her own three requests, not Tomo''s');

-- Another student's id and an id that does not exist give the same outcome.
SELECT is(pg_temp.ask(a.actor, format('SELECT count(*)::text FROM assistant.%I WHERE %I = %L', a.tbl, a.col, a.target)), '0',
  format('%s looks up %s %s: nothing, the same as an id that does not exist', a.actor, a.tbl, a.what))
FROM (VALUES
  ('ana', 'conversation', 'id', pg_temp.id('conv_t')::text, 'of Tomo'),
  ('ana', 'conversation', 'id', pg_temp.id('nobody')::text, 'that does not exist'),
  ('ana', 'message', 'conversation_id', pg_temp.id('conv_t')::text, 'of Tomo'),
  ('ana', 'message', 'conversation_id', pg_temp.id('nobody')::text, 'that does not exist'),
  ('ana', 'request', 'id', pg_temp.id('r3')::text, 'of Tomo'),
  ('ana', 'request', 'id', pg_temp.id('nobody')::text, 'that does not exist'),
  ('dora', 'conversation', 'id', pg_temp.id('conv_a')::text, 'of Ana'),
  ('dora', 'conversation', 'id', pg_temp.id('nobody')::text, 'that does not exist'),
  ('dora', 'message', 'id', pg_temp.id('m1')::text, 'of Ana'),
  ('dora', 'message', 'id', pg_temp.id('nobody')::text, 'that does not exist'),
  ('dora', 'request', 'id', pg_temp.id('r1')::text, 'of Ana'),
  ('dora', 'request', 'id', pg_temp.id('nobody')::text, 'that does not exist'),
  ('vesna', 'conversation', 'id', pg_temp.id('conv_a')::text, 'of her student Ana'),
  ('vesna', 'message', 'conversation_id', pg_temp.id('conv_a')::text, 'of her student Ana'),
  ('vesna', 'request', 'id', pg_temp.id('r1')::text, 'of her student Ana'),
  ('iva', 'conversation', 'id', pg_temp.id('conv_a')::text, 'of her institution'),
  ('iva', 'request', 'id', pg_temp.id('r1')::text, 'of her institution')
) AS a (actor, tbl, col, target, what);
-- A teacher, even of Ana's course, reads no message while she writes (G1, G2);
-- the attached conversation after submission comes with M9.5, through an RPC.
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*)::text FROM assistant.message m JOIN assistant.conversation c ON c.id = m.conversation_id $$),
  '0', 'the teacher of the course reads no conversation of her student while it is written');

-- The worker ("stanje i ID-ovi", "svodi kroz RPC"), the operator and every
-- other runtime role: not even the schema. The worker reads the state and ids
-- of a request only through sweep_and_settle (SRV-1203), so it uses the
-- schema but reads no table.
SELECT is(pg_temp.reads(r, 'anon', t), CASE r WHEN 'ductus_worker' THEN 'no privilege' ELSE 'no schema privilege' END,
  format('%s reads nothing of %s', r, t))
FROM unnest(ARRAY['ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_test_stranger']) AS r
CROSS JOIN unnest(ARRAY['conversation', 'message', 'request', 'cost_ledger', 'budget_counter', 'cost_config_version']) AS t;

-- 4. No direct write by the web role (with the owner's, the teacher's or the
-- administrator's session) or the worker (M1, M2).
CREATE FUNCTION pg_temp.writes(p_role text, p_actor text, p_table text, p_op text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_column text;
BEGIN
  SELECT attname INTO STRICT v_column FROM pg_attribute WHERE attrelid = ('assistant.' || p_table)::regclass AND attnum = 1;
  RETURN left(coalesce(pg_temp.ask_as(p_role, p_actor, CASE p_op
    WHEN 'INSERT' THEN format('WITH x AS (INSERT INTO assistant.%I DEFAULT VALUES RETURNING 1) SELECT count(*)::text FROM x', p_table)
    WHEN 'UPDATE' THEN format('WITH x AS (UPDATE assistant.%I SET %I = %I RETURNING 1) SELECT count(*)::text FROM x', p_table, v_column, v_column)
    WHEN 'DELETE' THEN format('WITH x AS (DELETE FROM assistant.%I RETURNING 1) SELECT count(*)::text FROM x', p_table)
    WHEN 'TRUNCATE' THEN format('TRUNCATE assistant.%I CASCADE', p_table)
  END), 'done'), 5);
END
$$;
SELECT is(pg_temp.writes(r.role, r.actor, t, o), '42501', format('%s (%s) cannot %s %s', r.role, r.actor, o, t))
FROM (VALUES ('ductus_app', 'ana'), ('ductus_app', 'iva'), ('ductus_app', 'vesna'), ('ductus_worker', 'anon')) AS r (role, actor)
CROSS JOIN unnest(ARRAY['conversation', 'message', 'request', 'cost_ledger', 'budget_counter', 'cost_config_version']) AS t
CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS o;

-- 5. Triggers, for the owner role too.
-- Messages are only added (M7, G4); a conversation is never deleted (G7).
SELECT is(pg_temp.own(s.sql), 'ZD409', s.why)
FROM (VALUES
  (format($$ UPDATE assistant.message SET content = 'Drugo.', content_sha256 = %L WHERE id = %L $$, pg_temp.sha('Drugo.'), pg_temp.id('m1')),
   'a message is never edited'),
  (format($$ UPDATE assistant.message SET seq = 9 WHERE id = %L $$, pg_temp.id('m2')), 'a message keeps its seq'),
  (format($$ DELETE FROM assistant.message WHERE id = %L $$, pg_temp.id('m1')), 'a message is never deleted'),
  ('TRUNCATE assistant.message', 'the messages are never truncated'),
  (format($$ DELETE FROM assistant.conversation WHERE id = %L $$, pg_temp.id('conv_a')), 'a conversation is never deleted (G7)'),
  (format($$ UPDATE assistant.conversation SET assignment_id = %L WHERE id = %L $$, pg_temp.id('z2'), pg_temp.id('conv_a')),
   'a conversation never moves to another assignment'),
  ('TRUNCATE assistant.conversation CASCADE', 'the conversations are never truncated'),
  (format($$ DELETE FROM assistant.request WHERE id = %L $$, pg_temp.id('r2')), 'a request is never deleted'),
  ('TRUNCATE assistant.request CASCADE', 'the requests are never truncated'),
  (format($$ DELETE FROM assistant.cost_ledger WHERE request_id = %L $$, pg_temp.id('r4')), 'a ledger row is never deleted'),
  ('TRUNCATE assistant.cost_ledger', 'the ledger is never truncated'),
  (format($$ UPDATE assistant.cost_config_version SET cap_micro = 1 WHERE version_no = 1 $$), 'a configuration version is never changed'),
  ('DELETE FROM assistant.cost_config_version', 'a configuration version is never deleted'),
  ('TRUNCATE assistant.cost_config_version CASCADE', 'the configuration is never truncated')
) AS s (sql, why);
SELECT is((SELECT count(*) FROM assistant.message), 3::bigint, 'every message is still there');
SELECT is((SELECT count(*) FROM assistant.conversation), 2::bigint, 'every conversation is still there');

-- Request transitions: only the pairs of the contract's table (R1).
SELECT is(pg_temp.own(format($$ UPDATE assistant.request SET state = %L, reason = %s, sent_at = %s, finished_at = %s WHERE id = %L $$,
    t.state, t.reason, t.sent_at, t.finished_at, pg_temp.id(t.req))), t.outcome, t.why)
FROM (VALUES
  ('r4', 'completed', 'NULL', 'now()', 'now()', 'ZD409', 'reserved cannot jump to completed'),
  ('r4', 'outcome_unknown', 'NULL', 'now()', 'NULL', 'ZD409', 'reserved cannot jump to outcome_unknown'),
  ('r4', 'settled', 'NULL', 'now()', 'now()', 'ZD409', 'reserved cannot jump to settled'),
  ('r1', 'sent', 'NULL', 'sent_at', 'NULL', 'ZD409', 'completed is final'),
  ('r2', 'reserved', 'NULL', 'NULL', 'NULL', 'ZD409', 'rejected is final'),
  ('r3', 'reserved', 'NULL', 'NULL', 'NULL', 'ZD409', 'sent never goes back to reserved'),
  ('r3', 'rejected', $$'forbidden'$$, 'sent_at', 'now()', 'ZD409', 'sent cannot be rejected'),
  ('r3', 'settled', 'NULL', 'sent_at', 'now()', 'ZD409', 'sent cannot be settled before outcome_unknown'),
  ('r3', 'outcome_unknown', 'NULL', 'sent_at', 'NULL', 'ok', 'sent moves to outcome_unknown'),
  ('r3', 'completed', 'NULL', 'sent_at', 'now()', 'ZD409', 'a late response after outcome_unknown cannot complete (R7)'),
  ('r3', 'settled', 'NULL', 'sent_at', 'now()', 'ok', 'outcome_unknown is settled once'),
  ('r3', 'settled', 'NULL', 'sent_at', 'finished_at', 'ZD409', 'settled is final: a second settling changes nothing'),
  ('r4', 'rejected', $$'purpose_not_allowed'$$, 'NULL', 'now()', 'ok', 'reserved is rejected on a revoked policy (I3)')
) AS t (req, state, reason, sent_at, finished_at, outcome, why);
SELECT is(pg_temp.own(format($$ UPDATE assistant.request SET %s WHERE id = %L $$, c.change, pg_temp.id('r1'))), 'ZD409',
  'a request never changes its ' || c.what)
FROM (VALUES
  ('purpose_key = ''translation''', 'purpose'), ('idempotency_key = gen_random_uuid()', 'idempotency key'),
  ('student_id = ' || quote_literal(pg_temp.id('dora')), 'student'), ('provider_id = ''provider-test-b''', 'provider'),
  ('model_id = ''model-test-2''', 'model'), ('request_sha256 = repeat(''0'', 64)', 'hash'),
  ('requested_at = requested_at - interval ''1 day''', 'time of request'), ('state = state', 'state in place')
) AS c (change, what);

-- The ledger: a reserved row is settled or released once, then frozen (M7);
-- the keys of the counters it moves never change (T6).
SELECT is(pg_temp.own(format($$ UPDATE assistant.cost_ledger SET %s WHERE request_id = %L $$, l.change, pg_temp.id(l.req))),
  l.outcome, l.why)
FROM (VALUES
  ('r1', 'actual_micro = 6', 'ZD409', 'a settled row keeps its amount'),
  ('r1', 'state = ''released'', actual_micro = NULL', 'ZD409', 'a settled row is not released afterwards'),
  ('r4', 'budget_day = ''2026-11-23''', 'ZD409', 'a reserved row keeps its day'),
  ('r4', 'service_cap_period_start = ''2026-10-01''', 'ZD409', 'a reserved row keeps its service period'),
  ('r4', 'reserved_micro = 8', 'ZD409', 'a reserved row keeps its reservation'),
  ('r4', 'state = ''released'', settled_at = now()', 'ok', 'a reserved row is released'),
  ('r4', 'state = ''settled'', actual_micro = 7', 'ZD409', 'a released row is never settled afterwards'),
  ('r4', 'settled_at = settled_at + interval ''1 second''', 'ZD409', 'a released row keeps its time'),
  ('r3', 'state = ''settled'', actual_micro = 9, settled_at = now()', 'ok', 'a reserved row is settled, above the reservation (R6)'),
  ('r3', 'state = ''settled'', actual_micro = 9, settled_at = now()', 'ZD409', 'a second settling is refused')
) AS l (req, change, outcome, why);

-- Configuration: one line of versions per scope, each the next one.
SELECT is(pg_temp.own(format($$ INSERT INTO assistant.cost_config_version (institution_id, version_no, cap_micro, cap_period, published_by)
    VALUES (%s, %s, 10, 'day', %L) $$, c.inst, c.version_no, c.publisher)), c.outcome, c.why)
FROM (VALUES
  ('NULL', 3, pg_temp.id('operator'), 'ZD409', 'the service cannot skip a version'),
  ('NULL', 1, pg_temp.id('operator'), 'ZD409', 'the service cannot write its first version again'),
  ('NULL', 2, pg_temp.id('operator'), 'ok', 'the service publishes its second version'),
  (quote_literal(pg_temp.id('fak_b')), 2, pg_temp.id('lea'), 'ZD409', 'an institution begins at version 1'),
  (quote_literal(pg_temp.id('fak_b')), 1, pg_temp.id('lea'), 'ok', 'another institution has a line of its own'),
  (quote_literal(pg_temp.id('fak_a')), 2, pg_temp.id('iva'), 'ok', 'the institution publishes its second version')
) AS c (inst, version_no, publisher, outcome, why);
SELECT is((SELECT string_agg(coalesce(institution_id::text, 'service') || ':' || version_no, ',' ORDER BY institution_id NULLS FIRST, version_no)
             FROM assistant.cost_config_version),
  'service:1,service:2,' || pg_temp.id('fak_a') || ':1,' || pg_temp.id('fak_a') || ':2,' || pg_temp.id('fak_b') || ':1',
  'every version written is there, in order, without a gap');

-- 6. Negative controls (docs/TESTING.md 5): with the trigger disabled the
-- very same statement goes through, so the trigger is what refuses it. Each
-- runs in a subtransaction that is rolled back, then the trigger is enabled.
CREATE FUNCTION pg_temp.without(p_table text, p_trigger text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  EXECUTE format('ALTER TABLE assistant.%I DISABLE TRIGGER %I', p_table, p_trigger);
  BEGIN
    v := pg_temp.own(p_sql);
    RAISE EXCEPTION 'roll back' USING ERRCODE = 'ZT001';
  EXCEPTION WHEN SQLSTATE 'ZT001' THEN
    NULL;
  END;
  EXECUTE format('ALTER TABLE assistant.%I ENABLE TRIGGER %I', p_table, p_trigger);
  RETURN v;
END
$$;
SELECT is(pg_temp.without(c.tbl, c.trg, c.sql), 'ok', 'without ' || c.trg || ' ' || c.why)
FROM (VALUES
  ('message', 'message_append_only', format($$ DELETE FROM assistant.message WHERE id = %L $$, pg_temp.id('m2')),
   'a message could be deleted'),
  ('message', 'message_no_truncate', 'TRUNCATE assistant.message', 'the messages could be truncated'),
  ('conversation', 'conversation_no_change',
   format($$ UPDATE assistant.conversation SET created_at = created_at WHERE id = %L $$, pg_temp.id('conv_a')),
   'a conversation could be rewritten'),
  ('request', 'request_transition', format($$ UPDATE assistant.request SET state = 'sent', finished_at = NULL WHERE id = %L $$, pg_temp.id('r1')),
   'a completed request could go back to sent'),
  ('request', 'request_no_delete', format($$ DELETE FROM assistant.request WHERE id = %L $$, pg_temp.id('r2')),
   'a refused request could be deleted'),
  ('cost_ledger', 'cost_ledger_settle_once', format($$ UPDATE assistant.cost_ledger SET actual_micro = 6 WHERE request_id = %L $$, pg_temp.id('r1')),
   'a settled amount could be changed'),
  ('cost_ledger', 'cost_ledger_no_delete', format($$ DELETE FROM assistant.cost_ledger WHERE request_id = %L $$, pg_temp.id('r4')),
   'a ledger row could be deleted'),
  ('cost_config_version', 'cost_config_version_append_only', 'UPDATE assistant.cost_config_version SET cap_micro = 1',
   'a configuration version could be changed'),
  ('cost_config_version', 'cost_config_version_next', format($$ INSERT INTO assistant.cost_config_version
    (institution_id, version_no, cap_micro, cap_period, published_by) VALUES (NULL, 9, 1, 'day', %L) $$, pg_temp.id('operator')),
   'a version could skip the line')
) AS c (tbl, trg, sql, why);
ALTER TABLE assistant.cost_config_version ENABLE TRIGGER cost_config_version_has_event;
SELECT is_empty(
  $$ SELECT tgrelid::regclass || ' ' || tgname FROM pg_trigger
      WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'assistant'::regnamespace) AND NOT tgisinternal
        AND tgenabled <> 'O' $$,
  'every trigger is enabled again after the controls');
SELECT is((SELECT count(*) FROM assistant.message), 3::bigint, 'the controls left every message in place');

SELECT * FROM finish();
ROLLBACK;
