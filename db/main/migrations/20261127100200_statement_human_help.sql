-- migrate:up
-- SRV-1510. One student's declaration for a committed revision. The request
-- binds a confirmed version atomically with the existing submission insert.
SET LOCAL ROLE ductus_migrator;
CREATE SCHEMA declaration;
GRANT USAGE ON SCHEMA declaration TO ductus_app, ductus_evidence;
GRANT CREATE ON SCHEMA declaration TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

CREATE TABLE declaration.statement (
  id uuid PRIMARY KEY,
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  assignment_version integer NOT NULL,
  project_id text NOT NULL,
  principal_id uuid NOT NULL,
  document_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  form_text text NOT NULL,
  draft jsonb,
  payload_jcs text,
  content_sha256 text,
  CHECK ((draft IS NULL) <> (payload_jcs IS NULL)),
  CHECK (content_sha256 IS NOT DISTINCT FROM encode(sha256(convert_to(payload_jcs, 'UTF8')), 'hex')),
  UNIQUE (institution_id, assignment_id, principal_id, version),
  UNIQUE (id, institution_id, assignment_id, assignment_version, principal_id, document_id, revision, content_sha256),
  FOREIGN KEY (project_id, institution_id, principal_id, assignment_id)
    REFERENCES evidence.project (id, institution_id, principal_id, assignment_id),
  FOREIGN KEY (document_id, institution_id, project_id, principal_id)
    REFERENCES evidence.document (id, institution_id, project_id, principal_id),
  FOREIGN KEY (document_id, institution_id, revision)
    REFERENCES evidence.document_revision (document_id, institution_id, revision)
);
CREATE TABLE declaration.external_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  project_id text NOT NULL,
  principal_id uuid NOT NULL,
  format text NOT NULL CHECK (format IN ('application/pdf', 'text/plain')),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 2097152),
  content_sha256 text GENERATED ALWAYS AS (encode(sha256(content), 'hex')) STORED,
  UNIQUE (institution_id, assignment_id, principal_id, format, content_sha256),
  FOREIGN KEY (project_id, institution_id, principal_id, assignment_id)
    REFERENCES evidence.project (id, institution_id, principal_id, assignment_id)
);

ALTER TABLE declaration.statement ENABLE ROW LEVEL SECURITY;
ALTER TABLE declaration.statement FORCE ROW LEVEL SECURITY;
CREATE POLICY statement_owner ON declaration.statement TO ductus_evidence USING (true) WITH CHECK (true);
ALTER TABLE declaration.external_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE declaration.external_attachment FORCE ROW LEVEL SECURITY;
CREATE POLICY attachment_owner ON declaration.external_attachment TO ductus_evidence USING (true) WITH CHECK (true);
CREATE TRIGGER statement_immutable BEFORE UPDATE OR DELETE ON declaration.statement
  FOR EACH ROW WHEN (OLD.payload_jcs IS NOT NULL) EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER statement_no_truncate BEFORE TRUNCATE ON declaration.statement
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER attachment_immutable BEFORE UPDATE OR DELETE ON declaration.external_attachment
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER attachment_no_truncate BEFORE TRUNCATE ON declaration.external_attachment
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

ALTER TABLE evidence.submission_request
  ADD COLUMN declaration_version_id uuid,
  ADD COLUMN declaration_sha256 text,
  ADD CONSTRAINT request_declaration_pair CHECK ((declaration_version_id IS NULL) = (declaration_sha256 IS NULL)),
  ADD CONSTRAINT request_declaration_pin FOREIGN KEY
    (declaration_version_id, institution_id, assignment_id, assignment_version, principal_id, document_id, revision, declaration_sha256)
    REFERENCES declaration.statement
    (id, institution_id, assignment_id, assignment_version, principal_id, document_id, revision, content_sha256);

-- The same order as app.request_submission: membership and assignment, then
-- the document. Serialize by student/assignment too, since evidence can have
-- more than one document for an assignment. The request trigger takes this
-- last lock with the submission document already held.
CREATE FUNCTION declaration.lock_scope(p_institution uuid, p_assignment uuid, p_student uuid)
RETURNS void LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(
    'declaration:' || p_institution::text || ':' || p_assignment::text || ':' || p_student::text, 0))
$$;

CREATE FUNCTION declaration.pin_request() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- app.request_submission runs as the evidence owner. Any other caller
  -- reaches its ordinary RLS check without invoking a private helper.
  IF current_user <> 'ductus_evidence' THEN RETURN NEW; END IF;
  PERFORM declaration.lock_scope(NEW.institution_id, NEW.assignment_id, NEW.principal_id);
  SELECT s.id, s.content_sha256 INTO NEW.declaration_version_id, NEW.declaration_sha256
    FROM declaration.statement s
   WHERE s.institution_id = NEW.institution_id AND s.assignment_id = NEW.assignment_id
     AND s.principal_id = NEW.principal_id AND s.payload_jcs IS NOT NULL
   ORDER BY s.version DESC LIMIT 1;
  IF NEW.declaration_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM declaration.statement s WHERE s.id = NEW.declaration_version_id
      AND s.document_id = NEW.document_id AND s.revision = NEW.revision
      AND s.assignment_version = NEW.assignment_version
  ) THEN
    NEW.declaration_version_id := NULL;
    NEW.declaration_sha256 := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pin_declaration BEFORE INSERT ON evidence.submission_request
  FOR EACH ROW EXECUTE FUNCTION declaration.pin_request();

CREATE FUNCTION declaration.student_document(p_institution uuid, p_assignment uuid, p_student uuid)
RETURNS SETOF evidence.document LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT d.* FROM evidence.project p JOIN evidence.document d
    ON (d.project_id, d.institution_id, d.principal_id) = (p.id, p.institution_id, p.principal_id)
   WHERE p.institution_id = p_institution AND p.assignment_id = p_assignment AND p.principal_id = p_student
   ORDER BY d.created_at, d.id LIMIT 1 FOR UPDATE OF d
$$;

CREATE FUNCTION declaration.attachment_ref(a declaration.external_attachment) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('externalAttachmentId', a.id, 'format', a.format,
    'byteLength', octet_length(a.content), 'contentSha256', a.content_sha256)
$$;

CREATE FUNCTION declaration.view_statement(p_institution uuid, p_assignment uuid, p_student uuid,
  p_revision bigint, p_assignment_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_request evidence.submission_request%ROWTYPE;
  v_saved declaration.statement%ROWTYPE;
  v_uploads jsonb;
  v_state text;
BEGIN
  SELECT * INTO v_request FROM evidence.submission_request q
    WHERE (q.institution_id, q.assignment_id, q.principal_id) = (p_institution, p_assignment, p_student);
  SELECT * INTO v_saved FROM declaration.statement s
    WHERE (s.institution_id, s.assignment_id, s.principal_id) = (p_institution, p_assignment, p_student)
      AND (v_request.id IS NULL OR s.id = v_request.declaration_version_id)
    ORDER BY s.version DESC LIMIT 1;
  v_state := CASE WHEN v_saved.id IS NULL THEN 'none'
    WHEN v_request.id IS NOT NULL THEN 'bound'
    WHEN v_saved.draft IS NOT NULL THEN 'draft'
    WHEN v_saved.revision = p_revision AND v_saved.assignment_version = p_assignment_version THEN 'confirmed'
    ELSE 'stale' END;
  SELECT coalesce(jsonb_agg(declaration.attachment_ref(a) ORDER BY a.id), '[]'::jsonb) INTO v_uploads
    FROM declaration.external_attachment a
    WHERE (a.institution_id, a.assignment_id, a.principal_id) = (p_institution, p_assignment, p_student);
  RETURN jsonb_build_object('status', 'ok', 'statement', jsonb_build_object(
    'state', v_state, 'submitted', v_request.id IS NOT NULL, 'currentRevision', p_revision,
    'version', coalesce(v_saved.version, 0), 'formText', v_saved.form_text, 'draft', v_saved.draft,
    'payload', v_saved.payload_jcs::jsonb, 'declarationSha256', v_saved.content_sha256, 'uploads', v_uploads));
END $$;

CREATE FUNCTION declaration.read_statement(p_assignment uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor record; v_version integer; v_document evidence.document%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL THEN RETURN '{"status":"unauthorized"}'; END IF;
  SELECT a.current_version INTO v_version FROM app.lock_student_assignment(p_assignment) a;
  IF NOT FOUND THEN RETURN '{"status":"not_found"}'; END IF;
  SELECT * INTO v_document FROM declaration.student_document(v_actor.institution_id, p_assignment, v_actor.user_id);
  RETURN declaration.view_statement(v_actor.institution_id, p_assignment, v_actor.user_id,
    v_document.current_revision, v_version);
END $$;

-- The payload has fixed ASCII keys, integer numbers and Unicode text.
-- Sort keys bytewise and keep array order when encoding this JCS subset.
CREATE FUNCTION declaration.canonical_payload(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'object' THEN '{' || coalesce((SELECT string_agg(
      to_json(e.key)::text || ':' || declaration.canonical_payload(e.value), ',' ORDER BY e.key COLLATE "C")
      FROM jsonb_each(p_value) e), '') || '}'
    WHEN 'array' THEN '[' || coalesce((SELECT string_agg(
      declaration.canonical_payload(e.value), ',' ORDER BY e.n)
      FROM jsonb_array_elements(p_value) WITH ORDINALITY e(value,n)), '') || ']'
    ELSE p_value::text END
$$;

CREATE FUNCTION declaration.valid_text(p_text text, p_limit integer, p_multiline boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(char_length(p_text) BETWEEN 1 AND p_limit AND p_text IS NFC NORMALIZED
    AND p_text !~ '^[[:space:]]|[[:space:]]$'
    AND (CASE WHEN p_multiline THEN replace(p_text, chr(10), '') ELSE p_text END)
      !~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069\FEFF]', false)
$$;

CREATE FUNCTION declaration.save_statement(p_assignment uuid, p_body jsonb, p_form_file text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor record;
  v_assignment_version integer;
  v_document evidence.document%ROWTYPE;
  v_form jsonb;
  v_ai jsonb := p_body->'ai';
  v_help jsonb := p_body->'humanHelp';
  v_selected jsonb;
  v_count integer;
  v_version bigint;
  v_previous jsonb;
  v_id uuid := gen_random_uuid();
  v_payload text;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL THEN RETURN '{"status":"unauthorized"}'; END IF;
  SELECT a.current_version INTO v_assignment_version FROM app.lock_student_assignment(p_assignment) a;
  IF NOT FOUND THEN RETURN '{"status":"not_found"}'; END IF;
  SELECT * INTO v_document FROM declaration.student_document(v_actor.institution_id, p_assignment, v_actor.user_id);
  IF NOT FOUND THEN RETURN '{"status":"not_found"}'; END IF;
  PERFORM declaration.lock_scope(v_actor.institution_id, p_assignment, v_actor.user_id);

  SELECT coalesce(max(s.version), 0) INTO v_version FROM declaration.statement s
   WHERE (s.institution_id, s.assignment_id, s.principal_id) = (v_actor.institution_id, p_assignment, v_actor.user_id);
  IF v_document.current_revision = 0 OR (p_body->'revision') IS DISTINCT FROM to_jsonb(v_document.current_revision)
     OR (p_body->'baseVersion') IS DISTINCT FROM to_jsonb(v_version)
     OR EXISTS (SELECT 1 FROM evidence.submission_request q WHERE (q.institution_id, q.assignment_id, q.principal_id)
       = (v_actor.institution_id, p_assignment, v_actor.user_id))
  THEN RETURN '{"status":"conflict"}'; END IF;

  IF p_form_file IS NULL THEN RETURN '{"status":"conflict"}'; END IF;
  IF octet_length(p_form_file) NOT BETWEEN 1 AND 128000
     OR octet_length(p_body::text) > 800000
  THEN RETURN '{"status":"invalid_input"}'; END IF;
  v_form := p_form_file::jsonb;
  IF v_form->>'formSchema' IS DISTINCT FROM 'ductura-declaration-form-v1'
     OR coalesce(v_form->>'formId','') !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     OR coalesce(v_form->>'formVersion','') !~ '^[1-9][0-9]{0,9}$'
     OR (v_form->>'formVersion')::bigint > 2147483647
     OR NOT declaration.valid_text(v_form->>'text', 20000, true)
  THEN RETURN '{"status":"invalid_input"}'; END IF;
  IF (p_body->'form') IS DISTINCT FROM jsonb_build_object('formId', v_form->'formId', 'formVersion',
      v_form->'formVersion', 'formSha256', encode(sha256(convert_to(p_form_file, 'UTF8')), 'hex'))
  THEN RETURN '{"status":"conflict"}'; END IF;

  IF jsonb_typeof(p_body->'confirm') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_body#>'{ownWork,confirmed}') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(v_help->'received') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(v_help->'entries') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_ai->'declaredTools') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_ai->'externalAttachmentIds') IS DISTINCT FROM 'array'
     OR v_ai->'use' IS NULL OR v_ai->'use' NOT IN ('null'::jsonb, '"used"'::jsonb, '"not_used"'::jsonb)
     OR (v_ai->'attachments') IS DISTINCT FROM '[]'::jsonb
  THEN RETURN '{"status":"invalid_input"}'; END IF;
  IF v_help IS DISTINCT FROM jsonb_build_object('received',v_help->'received','entries',v_help->'entries')
     OR v_ai IS DISTINCT FROM jsonb_build_object('use',v_ai->'use','declaredTools',v_ai->'declaredTools',
       'attachments','[]'::jsonb,'externalAttachmentIds',v_ai->'externalAttachmentIds')
     OR p_body IS DISTINCT FROM jsonb_build_object('baseVersion',v_version,'revision',v_document.current_revision,
       'form',p_body->'form','ownWork',jsonb_build_object('confirmed',p_body#>'{ownWork,confirmed}'),
       'humanHelp',v_help,'ai',v_ai,'confirm',p_body->'confirm')
  THEN RETURN '{"status":"invalid_input"}'; END IF;
  IF jsonb_array_length(v_help->'entries') > 20 OR jsonb_array_length(v_ai->'declaredTools') > 20
     OR jsonb_array_length(v_ai->'externalAttachmentIds') > 10
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_help->'entries') e
       WHERE coalesce(e->>'kind','') NOT IN ('language','structure','sources','content','technical','other')
          OR jsonb_typeof(e->'text') IS DISTINCT FROM 'string'
          OR NOT declaration.valid_text(e->>'text', 2000, true)
          OR e IS DISTINCT FROM jsonb_build_object('kind',e->'kind','text',e->'text'))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ai->'declaredTools') e
       WHERE jsonb_typeof(e->'toolLabel') IS DISTINCT FROM 'string'
          OR jsonb_typeof(e->'purposeText') IS DISTINCT FROM 'string'
          OR jsonb_typeof(e->'phaseText') IS DISTINCT FROM 'string'
          OR NOT declaration.valid_text(e->>'toolLabel', 200, false)
          OR NOT declaration.valid_text(e->>'purposeText', 200, false)
          OR NOT declaration.valid_text(e->>'phaseText', 200, false)
          OR e IS DISTINCT FROM jsonb_build_object('toolLabel',e->'toolLabel','purposeText',e->'purposeText','phaseText',e->'phaseText'))
  THEN RETURN '{"status":"invalid_input"}'; END IF;
  SELECT coalesce(jsonb_agg(declaration.attachment_ref(a) || '{"reason":"external_upload"}'::jsonb
    ORDER BY a.id), '[]'::jsonb), count(*) INTO v_selected, v_count
    FROM declaration.external_attachment a WHERE
    (a.institution_id, a.assignment_id, a.principal_id) = (v_actor.institution_id, p_assignment, v_actor.user_id)
    AND (v_ai->'externalAttachmentIds') ? a.id::text;
  IF v_count <> jsonb_array_length(v_ai->'externalAttachmentIds') THEN RETURN '{"status":"not_found"}'; END IF;

  IF p_body->'confirm' = 'true'::jsonb THEN
    IF p_body#>'{ownWork,confirmed}' <> 'true'::jsonb OR coalesce(v_ai->>'use','') = ''
       OR (v_help->'received' = 'true'::jsonb) <> (jsonb_array_length(v_help->'entries') > 0)
       OR (v_ai->>'use' = 'not_used' AND jsonb_array_length(v_ai->'declaredTools') > 0)
    THEN RETURN '{"status":"conflict"}'; END IF;
    SELECT s.payload_jcs::jsonb INTO v_previous FROM declaration.statement s
      WHERE (s.institution_id, s.assignment_id, s.principal_id) = (v_actor.institution_id, p_assignment, v_actor.user_id)
        AND s.payload_jcs IS NOT NULL
      ORDER BY s.version DESC LIMIT 1;
    v_payload := declaration.canonical_payload(jsonb_build_object('declarationSchema','ductura-declaration-v1',
      'declarationId',coalesce(v_previous->>'declarationId',v_id::text),
      'declarationVersion',coalesce((v_previous->>'declarationVersion')::bigint,0) + 1,
      'principalId',v_actor.user_id,
      'assignmentId',p_assignment,'assignmentVersion',v_assignment_version,'documentId',v_document.id,
      'revision',v_document.current_revision,'form',p_body->'form','ownWork','{"confirmed":true}'::jsonb,
      'humanHelp',jsonb_build_object('received',v_help->'received','entries',v_help->'entries'),
      'ai',jsonb_build_object('use',v_ai->'use','declaredTools',v_ai->'declaredTools','recorded','[]'::jsonb,
        'attachments',v_selected),
      'confirmedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  END IF;
  DELETE FROM declaration.statement s WHERE s.draft IS NOT NULL
    AND (s.institution_id, s.assignment_id, s.principal_id) = (v_actor.institution_id, p_assignment, v_actor.user_id);
  INSERT INTO declaration.statement (id,institution_id,assignment_id,assignment_version,project_id,principal_id,
    document_id,revision,version,form_text,draft,payload_jcs,content_sha256)
    VALUES (v_id,v_actor.institution_id,p_assignment,v_assignment_version,v_document.project_id,v_actor.user_id,
      v_document.id,v_document.current_revision,v_version + 1,v_form->>'text',
      CASE WHEN v_payload IS NULL THEN p_body END,
      v_payload, encode(sha256(convert_to(v_payload, 'UTF8')), 'hex'));
  RETURN declaration.view_statement(v_actor.institution_id, p_assignment, v_actor.user_id,
    v_document.current_revision, v_assignment_version);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN '{"status":"invalid_input"}';
END $$;

CREATE FUNCTION declaration.upload_attachment(p_assignment uuid, p_format text, p_content bytea) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor record; v_document evidence.document%ROWTYPE; v_file declaration.external_attachment%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL THEN RETURN '{"status":"unauthorized"}'; END IF;
  PERFORM 1 FROM app.lock_student_assignment(p_assignment);
  IF NOT FOUND THEN RETURN '{"status":"not_found"}'; END IF;
  SELECT * INTO v_document FROM declaration.student_document(v_actor.institution_id, p_assignment, v_actor.user_id);
  IF NOT FOUND THEN RETURN '{"status":"not_found"}'; END IF;
  IF coalesce(p_format,'') NOT IN ('application/pdf','text/plain') OR p_content IS NULL
     OR octet_length(p_content) NOT BETWEEN 1 AND 2097152
     OR (p_format = 'application/pdf' AND substring(p_content FROM 1 FOR 5) <> convert_to('%PDF-', 'UTF8'))
  THEN RETURN '{"status":"invalid_input"}'; END IF;
  IF p_format = 'text/plain' AND (substring(p_content FROM 1 FOR 3) = decode('efbbbf','hex')
      OR replace(replace(convert_from(p_content,'UTF8'),chr(10),''),chr(9),'') ~ U&'[\0001-\001F\007F-\009F]')
  THEN RETURN '{"status":"invalid_input"}'; END IF;
  PERFORM declaration.lock_scope(v_actor.institution_id, p_assignment, v_actor.user_id);
  IF EXISTS (SELECT 1 FROM evidence.submission_request q WHERE (q.institution_id, q.assignment_id, q.principal_id)
    = (v_actor.institution_id, p_assignment, v_actor.user_id)) THEN RETURN '{"status":"conflict"}'; END IF;
  SELECT a.* INTO v_file FROM declaration.external_attachment a
   WHERE (a.institution_id, a.assignment_id, a.principal_id) = (v_actor.institution_id, p_assignment, v_actor.user_id)
     AND a.format = p_format AND a.content_sha256 = encode(sha256(p_content),'hex');
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM declaration.external_attachment a
      WHERE (a.institution_id, a.assignment_id, a.principal_id) = (v_actor.institution_id, p_assignment, v_actor.user_id)
      HAVING count(*) >= 10 OR sum(octet_length(a.content)) + octet_length(p_content) > 10485760)
    THEN RETURN '{"status":"conflict"}'; END IF;
    INSERT INTO declaration.external_attachment (institution_id,assignment_id,project_id,principal_id,format,content)
      VALUES (v_actor.institution_id,p_assignment,v_document.project_id,v_actor.user_id,p_format,p_content)
      RETURNING * INTO v_file;
  END IF;
  RETURN declaration.attachment_ref(v_file) || '{"status":"ok"}'::jsonb;
EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN
  RETURN '{"status":"invalid_input"}';
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA declaration FROM PUBLIC;
GRANT EXECUTE ON FUNCTION declaration.read_statement(uuid), declaration.save_statement(uuid,jsonb,text),
  declaration.upload_attachment(uuid,text,bytea) TO ductus_app;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA declaration FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_evidence;
DROP TRIGGER pin_declaration ON evidence.submission_request;
ALTER TABLE evidence.submission_request DROP CONSTRAINT request_declaration_pin,
  DROP COLUMN declaration_version_id, DROP COLUMN declaration_sha256;
SET LOCAL ROLE ductus_migrator;
DROP SCHEMA declaration CASCADE;
