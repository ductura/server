-- SRV-9B (Ductus#2028, c.7041664094; ✓ C-6): app.public_receipt_verification.
-- Without a session, the submission id and the artifact hash of a receipt's QR
-- give "match" with the bound receipt and its key, and nothing else ever gives
-- more than "no_match". The answer is the same with any session or none: the
-- function is not a way in (D-09, C-23). Every person, key, text and
-- signature below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- outcome|payload|digest|signature|key|domain|purpose|valid_from|valid_to|revoked_at; NULLs are left out.
CREATE FUNCTION pg_temp.check(p_actor text, p_submission text, p_hash text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT string_agg(concat_ws('|', outcome, receipt_payload, payload_digest_sha256, signature::text,
                 key_base64url, key_evidence_domain_id, key_purpose, key_valid_from, key_valid_to, key_revoked_at), ';')
          FROM app.public_receipt_verification(%s::uuid, %s) $q$, p_submission, p_hash))
$$;

-- 1. Catalogue: who may call it, and how it runs.
SELECT has_function('app', 'public_receipt_verification', ARRAY['uuid', 'text'], 'the public check exists');
SELECT is(pg_get_function_arguments('app.public_receipt_verification(uuid,text)'::regprocedure),
  'p_submission_id uuid, p_artifact_sha256 text', 'only the two values of the QR: no person, session or institution');
SELECT ok((SELECT p.prosecdef AND p.provolatile = 's' AND p.proowner = 'ductus_evidence'::regrole
                  AND 'search_path=""' = ANY (p.proconfig)
             FROM pg_proc p WHERE p.oid = 'app.public_receipt_verification(uuid,text)'::regprocedure),
  'a STABLE SECURITY DEFINER function of the evidence role with an empty search_path');
SELECT is(ARRAY(SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_identity',
    'ductus_auth', 'ductus_migrator', 'ductus_test_stranger']) r
  WHERE has_function_privilege(r, 'app.public_receipt_verification(uuid,text)', 'EXECUTE')),
  ARRAY['ductus_app'], 'only the web role executes it');
SELECT is_empty($$ SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
  WHERE p.oid = 'app.public_receipt_verification(uuid,text)'::regprocedure AND a.grantee = 0 $$,
  'PUBLIC has no EXECUTE');

-- Fixture: Ana's submission of doc-a, text repeat('d', 64), and two keys of fak-a.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64), repeat('b', 64)),
  'reserved', 'fixture: revision one exists');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested', 'fixture: request');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission((SELECT id FROM evidence.submission_request), %L)',
  pg_temp.h('d'))), 'recorded', 'fixture: recorded submission');
INSERT INTO ref SELECT 'submission', id::text FROM evidence.submission;
INSERT INTO ref VALUES ('text', pg_temp.h('d')), ('other_text', pg_temp.h('e')),
  ('no_submission', '00000000-0000-4000-8000-0000000000ff');
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.signing_key
  (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm, key_base64url, valid_from)
SELECT k.name, '1', '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'receipt', 'Ed25519',
  'MCowBQYDK2VwAyEA' || translate(rtrim(encode(decode(repeat(k.byte, 32), 'hex'), 'base64'), '='), '+/', '-_'),
  date_trunc('minute', now()) - interval '1 day'
FROM (VALUES ('key-a', '11'), ('key-unused', '22')) AS k (name, byte);
RESET ROLE;

-- 2. A submission without a bound receipt is not confirmed, even with its own text.
SELECT is(pg_temp.check('anon', '{submission}', '{text}'), 'no_match', 'no bound receipt yet: no_match');

INSERT INTO ref SELECT 'i1', pg_temp.ask('ana',
  $$ SELECT issuance_id::text FROM app.prepare_submission_receipt({submission}::uuid, 'key-a', '1') $$);
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.attach_submission_receipt({i1}::uuid,
    (SELECT payload_digest_sha256 FROM evidence.submission_receipt_issuance WHERE id = {i1}::uuid),
    jsonb_build_object('algorithm', 'Ed25519', 'keyId', 'key-a', 'keyVersion', '1',
      'signatureEncoding', 'raw', 'signatureBase64Url', repeat('A', 86))) $$),
  'attached', 'fixture: the receipt is bound');

-- 3. The two values of the QR give the bound receipt and its one key, to anyone.
CREATE TEMP TABLE expected AS
SELECT concat_ws('|', 'match', r.receipt_payload, r.payload_digest_sha256, r.signature::text, k.key_base64url,
         k.evidence_domain_id, k.purpose, k.valid_from, k.valid_to, k.revoked_at) AS line
  FROM evidence.submission_receipt r JOIN evidence.signing_key k ON k.key_id = r.key_id;
SELECT is(pg_temp.check(v.actor, '{submission}', '{text}'), (SELECT line FROM expected), v.what)
FROM (VALUES
  (1, 'anon', 'without a session: match, with the signed receipt and key-a'),
  (2, 'expired', 'an expired session changes nothing'),
  (3, 'unknown', 'a token of no session changes nothing'),
  (4, 'ana', 'the student herself gets the same answer, no more'),
  (5, 'tomo', 'a student of another institution gets the same answer'),
  (6, 'marko', 'a teacher of another course gets the same answer')
) AS v (n, actor, what)
ORDER BY v.n;
SELECT ok((SELECT line FROM expected) LIKE 'match|{"%' AND (SELECT line FROM expected) LIKE '%|receipt|%',
  'the match row carries the payload and a receipt key');

-- 4. Anything else is the same bare no_match: one row, nothing in it.
SELECT is(pg_temp.check('anon', v.submission, v.hash), 'no_match', v.what)
FROM (VALUES
  (1, '{submission}', '{other_text}', 'another text of the same submission'),
  (2, '{submission}', quote_literal(upper(pg_temp.h('d'))), 'the right hash in capitals'),
  (3, '{submission}', quote_literal(pg_temp.h('d') || ' '), 'the right hash with a trailing space'),
  (4, '{submission}', quote_literal(left(pg_temp.h('d'), 63)), 'a hash one character short'),
  (5, '{submission}', 'NULL', 'no hash'),
  (6, '{no_submission}', '{text}', 'an unknown submission with the right text'),
  (7, 'NULL', '{text}', 'no submission'),
  (8, '{submission}', quote_literal('%'), 'a pattern is not a hash'),
  (9, '{submission}', quote_literal(repeat('b', 64)), 'the hash of the evidence segment, not of the text')
) AS v (n, submission, hash, what)
ORDER BY v.n;
SELECT is(pg_temp.check('ana', '{submission}', '{other_text}'), 'no_match', 'the owner learns nothing more for another text');

-- 5. A key revoked after the bind still comes back; the web process refuses it.
SET LOCAL ROLE ductus_evidence;
UPDATE evidence.signing_key SET revoked_at = now() WHERE key_id = 'key-a';
RESET ROLE;
SELECT ok(pg_temp.check('anon', '{submission}', '{text}') LIKE 'match|%|' || (SELECT revoked_at FROM evidence.signing_key
  WHERE key_id = 'key-a')::text, 'a revoked key comes back with its revocation time');

-- 6. Read only: nothing was written by any call.
SELECT is((SELECT count(*) FROM evidence.submission_receipt), 1::bigint, 'still one bound receipt');

SELECT * FROM finish();
ROLLBACK;
