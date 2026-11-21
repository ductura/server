-- SRV-1510. Synthetic declarations, attachments, actors and documents.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

CREATE FUNCTION pg_temp.statement_form() RETURNS text LANGUAGE sql AS $$
  SELECT '{"formId":"test-izjava","formSchema":"ductura-declaration-form-v1","formVersion":1,"text":"Izmišljeni obrazac."}'
$$;

CREATE FUNCTION pg_temp.statement_body(p_base integer, p_revision integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'baseVersion', p_base, 'revision', p_revision, 'confirm', true,
    'form', jsonb_build_object('formId','test-izjava','formVersion',1,
      'formSha256',pg_temp.sha(pg_temp.statement_form())),
    'ownWork', '{"confirmed":true}'::jsonb,
    'humanHelp', '{"received":true,"entries":[{"kind":"language","text":"Izmišljena kolegica pregledala je uvod."}]}'::jsonb,
    'ai', '{"use":"used","attachments":[],"declaredTools":[],"externalAttachmentIds":[]}'::jsonb)
$$;

CREATE FUNCTION pg_temp.save_statement(p_actor text, p_body jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT declaration.save_statement(%L, %L::jsonb, %L)',
    pg_temp.id('z1'), p_body, pg_temp.statement_form()))::jsonb
$$;

CREATE FUNCTION pg_temp.statement_value(p_name text) RETURNS text LANGUAGE sql AS $$
  SELECT val FROM ref WHERE name = p_name
$$;

SELECT is(pg_temp.call('ana','pkg-a','req-statement',pg_temp.descriptor(),0,
  repeat('a',64),repeat('d',64),repeat('b',64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.save_statement('ana', pg_temp.statement_body(0, 2))->>'status',
  'conflict', 'a revision that does not exist cannot be confirmed');
SELECT is(pg_temp.save_statement('tomo', pg_temp.statement_body(0, 1))->>'status',
  'not_found', 'a student of another faculty cannot confirm the work');
SELECT is(pg_temp.save_statement('ana', jsonb_set(pg_temp.statement_body(0, 1),
  '{humanHelp,entries,0,kind}', '"invented"'))->>'status',
  'invalid_input', 'the database refuses a help kind outside the closed set');
SELECT is(pg_temp.ask('ana', format(
  'SELECT declaration.upload_attachment(%L, %L, convert_to(%L, ''UTF8''))->>''status''',
  pg_temp.id('z1'), 'text/html', 'Izmišljeni ispis')), 'invalid_input', 'HTML is outside OD-3');

INSERT INTO ref SELECT 'statement-upload', pg_temp.ask('ana', format(
  'SELECT declaration.upload_attachment(%L, %L, convert_to(%L, ''UTF8''))->>''externalAttachmentId''',
  pg_temp.id('z1'), 'text/plain', 'Izmišljeni ispis'));
SELECT matches(pg_temp.statement_value('statement-upload'), '^[0-9a-f-]{36}$', 'a TXT upload returns an id');
SELECT is(pg_temp.save_statement('ana', jsonb_set(pg_temp.statement_body(0,1), '{confirm}', 'false'))
  #>> '{statement,state}', 'draft', 'the same declaration can first be saved as a draft');
INSERT INTO ref SELECT 'statement-saved', pg_temp.save_statement('ana',
  jsonb_set(pg_temp.statement_body(1,1), '{ai,externalAttachmentIds}',
    jsonb_build_array(pg_temp.statement_value('statement-upload'))))::text;
SELECT is(pg_temp.statement_value('statement-saved')::jsonb #>> '{statement,state}', 'confirmed',
  'the complete text is confirmed');
SELECT is(pg_temp.statement_value('statement-saved')::jsonb #>> '{statement,payload,revision}', '1',
  'the response names the exact revision');
SELECT is(pg_temp.statement_value('statement-saved')::jsonb #>> '{statement,payload,declarationVersion}', '1',
  'the first confirmation has version one even after a draft was saved');
SELECT is(pg_temp.statement_value('statement-saved')::jsonb #>> '{statement,payload,ai,attachments,0,contentSha256}',
  pg_temp.sha('Izmišljeni ispis'), 'the payload binds the bytes of the selected upload');
SELECT is(pg_temp.save_statement('ana', pg_temp.statement_body(1, 1))->>'status',
  'conflict', 'another writer with the same base version cannot overwrite the first');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a',1) $$),
  'requested', 'the usual submission RPC accepts the work');
SELECT is((SELECT declaration_sha256 FROM evidence.submission_request WHERE document_id='doc-a'),
  pg_temp.statement_value('statement-saved')::jsonb #>> '{statement,declarationSha256}',
  'the request pins the exact confirmed hash');
SELECT is(pg_temp.save_statement('ana', pg_temp.statement_body(2, 1))->>'status',
  'conflict', 'a save with the correct base still cannot change the bound statement');
SELECT is(pg_temp.ask('ana', format('SELECT declaration.read_statement(%L)#>>''{statement,state}''',
  pg_temp.id('z1'))), 'bound', 'the student reads the pinned statement');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon',
  $$ UPDATE declaration.statement SET form_text = 'Izmjena' RETURNING 1 $$),
  '^ZD403', 'even the table owner cannot rewrite a confirmed statement');

SELECT * FROM finish();
ROLLBACK;
