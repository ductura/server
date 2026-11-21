-- Access matrix of the institution module (B-7 parts 1 and 2;
-- docs/ARCHITECTURE.md 3 and 7; plan of attack on issue #153, items 1 to 8,
-- 10, 13 and 19). Synthetic fixtures only (fixtures/institution.inc).
BEGIN;
\ir fixtures/institution.inc
-- Denials are told apart by their message below, so the language is fixed.
SET LOCAL lc_messages TO 'C';

SELECT plan(2456);

SELECT ok(c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_evidence'::regrole
    AND NOT has_table_privilege('ductus_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    AND ARRAY(SELECT p.policyname::text FROM pg_policies p
      WHERE p.schemaname = 'declaration' AND p.tablename = c.relname
        AND p.roles = ARRAY['ductus_evidence'::name] AND p.cmd = 'ALL') = ARRAY[t.policy],
  t.relation || ': forced RLS and only the evidence owner has access')
  FROM (VALUES ('declaration.statement', 'statement_owner'),
               ('declaration.external_attachment', 'attachment_owner')) t(relation, policy)
  LEFT JOIN pg_class c ON c.oid = to_regclass(t.relation);
SELECT ok(p.prosecdef AND 'search_path=""' = ANY(p.proconfig)
    AND has_function_privilege('ductus_app', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('ductus_worker', p.oid, 'EXECUTE'),
  f.signature || ': definer RPC with an empty path, only for the application')
  FROM (VALUES ('declaration.read_statement(uuid)'), ('declaration.save_statement(uuid,jsonb,text)'),
               ('declaration.upload_attachment(uuid,text,bytea)')) f(signature)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.signature);

-- 1. The catalogue. A table, policy, grant or function that is added later
-- changes one of these lists, so it cannot arrive without a row here.
SELECT bag_eq(
  $$ SELECT c.relname::text FROM pg_class c
     WHERE c.relnamespace = 'institution'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f') $$,
  ARRAY['institution_settings', 'institution_role', 'course', 'course_enrollment_code', 'course_member', 'enrollment_attempt',
        'assignment', 'assignment_version', 'notice_acknowledgment', 'faculty_work_rule', 'mentorship', 'notification',
        'course_holder', 'seminar_group', 'seminar_group_teacher', 'seminar_group_member',
        'course_editor', 'team_substitution', 'work_grant', 'mentorship_request', 'faculty_rule_version',
        'work_language_override', 'work_accommodation', 'notice_read', 'work_source', 'work_attachment', 'source_proof',
        'deadline_extension', 'merlin_package', 'merlin_package_download', 'consultation_slot', 'work_milestone', 'work_milestone_deadline'],
  'the institution schema holds exactly the thirty-three tables of this matrix'
);
SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'institution'::regnamespace AND c.relkind = 'r'
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_identity'::regrole) $$,
  'every institution table has ENABLE and FORCE ROW LEVEL SECURITY and belongs to ductus_identity'
);
-- The privilege lists below name the group roles. has_*_privilege counts what a
-- role inherits, so a login that is a member of ductus_app (db/local/app-login.sql)
-- would appear with ductus_app's rows; they are left out here with NOT rolcanlogin,
-- and 010 checks every login (it may do nothing ductus_app may not, and holds no
-- grant of its own).
SELECT bag_eq(
  $$ SELECT r.rolname || ' ' || p.privilege || ' ' || c.relname
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname <> 'ductus_identity'
           UNION ALL SELECT 'public') AS r
     CROSS JOIN pg_class c
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p (privilege)
     WHERE c.relnamespace = 'institution'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
       AND (has_table_privilege(r.rolname, c.oid, p.privilege)
            OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                AND has_any_column_privilege(r.rolname, c.oid, p.privilege))) $$,
  ARRAY[
    'ductus_app SELECT institution_settings',
    'ductus_app SELECT institution_role',
    'ductus_app SELECT course',
    'ductus_app SELECT course_enrollment_code',
    'ductus_app SELECT course_member',
    'ductus_app SELECT assignment',
    'ductus_app SELECT assignment_version',
    'ductus_app SELECT notice_acknowledgment',
    'ductus_app SELECT mentorship',
    'ductus_app SELECT course_holder',
    'ductus_app SELECT seminar_group',
    'ductus_app SELECT seminar_group_teacher',
    'ductus_app SELECT seminar_group_member',
    'ductus_app SELECT course_editor',
    'ductus_app SELECT team_substitution',
    'ductus_app SELECT work_grant',
    'ductus_app SELECT mentorship_request',
    'ductus_app SELECT faculty_rule_version',
    'ductus_app SELECT work_language_override',
    'ductus_app SELECT work_accommodation',
    'ductus_app SELECT notice_read'
  ],
  'besides the owner only ductus_app holds a privilege on an institution table, and only SELECT'
);
SELECT bag_eq(
  $$ SELECT a.attname::text FROM pg_attribute a
     WHERE a.attrelid = 'institution.course_enrollment_code'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND NOT has_column_privilege('ductus_app', a.attrelid, a.attnum, 'SELECT') $$,
  ARRAY['code_hash'],
  'ductus_app may read every column of an enrolment code except its hash'
);
SELECT bag_eq(
  $$ SELECT tablename || ': ' || policyname || ' ' || cmd || ' to ' || array_to_string(roles, ',')
     FROM pg_policies WHERE schemaname = 'institution' $$,
  ARRAY[
    'institution_settings: institution_settings_owner ALL to ductus_identity',
    'institution_settings: institution_settings_read SELECT to ductus_app',
    'institution_role: institution_role_owner ALL to ductus_identity',
    'institution_role: institution_role_read SELECT to ductus_app',
    'course: course_owner ALL to ductus_identity',
    'course: course_read SELECT to ductus_app',
    'course_enrollment_code: course_enrollment_code_owner ALL to ductus_identity',
    'course_enrollment_code: course_enrollment_code_read SELECT to ductus_app',
    'course_member: course_member_owner ALL to ductus_identity',
    'course_member: course_member_read SELECT to ductus_app',
    'enrollment_attempt: enrollment_attempt_owner ALL to ductus_identity',
    'assignment: assignment_owner ALL to ductus_identity',
    'assignment: assignment_read SELECT to ductus_app',
    'assignment_version: assignment_version_owner ALL to ductus_identity',
    'assignment_version: assignment_version_read SELECT to ductus_app',
    'notice_acknowledgment: notice_acknowledgment_owner ALL to ductus_identity',
    'notice_acknowledgment: notice_acknowledgment_read SELECT to ductus_app',
    'faculty_work_rule: faculty_work_rule_owner ALL to ductus_identity',
    'mentorship: mentorship_owner ALL to ductus_identity',
    'mentorship: mentorship_read SELECT to ductus_app',
    'notification: notification_owner ALL to ductus_identity',
    'course_holder: course_holder_owner ALL to ductus_identity',
    'course_holder: course_holder_read SELECT to ductus_app',
    'seminar_group: seminar_group_owner ALL to ductus_identity',
    'seminar_group: seminar_group_read SELECT to ductus_app',
    'seminar_group_teacher: seminar_group_teacher_owner ALL to ductus_identity',
    'seminar_group_teacher: seminar_group_teacher_read SELECT to ductus_app',
    'seminar_group_member: seminar_group_member_owner ALL to ductus_identity',
    'seminar_group_member: seminar_group_member_read SELECT to ductus_app',
    'course_editor: course_editor_owner ALL to ductus_identity',
    'course_editor: course_editor_read SELECT to ductus_app',
    'team_substitution: team_substitution_owner ALL to ductus_identity',
    'team_substitution: team_substitution_read SELECT to ductus_app',
    'work_grant: work_grant_owner ALL to ductus_identity',
    'work_grant: work_grant_read SELECT to ductus_app',
    'mentorship_request: mentorship_request_owner ALL to ductus_identity',
    'mentorship_request: mentorship_request_read SELECT to ductus_app',
    'faculty_rule_version: faculty_rule_version_owner ALL to ductus_identity',
    'faculty_rule_version: faculty_rule_version_read SELECT to ductus_app',
    'work_language_override: work_language_override_owner ALL to ductus_identity',
    'work_language_override: work_language_override_read SELECT to ductus_app',
    'work_accommodation: work_accommodation_owner ALL to ductus_identity',
    'work_accommodation: work_accommodation_read SELECT to ductus_app',
    'notice_read: notice_read_owner ALL to ductus_identity',
    'notice_read: notice_read_read SELECT to ductus_app',
    'work_source: work_source_owner ALL to ductus_identity',
    'work_attachment: work_attachment_owner ALL to ductus_identity',
    'source_proof: source_proof_owner ALL to ductus_identity',
    'deadline_extension: deadline_extension_owner ALL to ductus_identity',
    'merlin_package: merlin_package_owner ALL to ductus_identity',
    'merlin_package_download: merlin_package_download_owner ALL to ductus_identity',
    'consultation_slot: consultation_slot_owner ALL to ductus_identity',
    'work_milestone: work_milestone_owner ALL to ductus_identity',
    'work_milestone_deadline: work_milestone_deadline_owner ALL to ductus_identity'
  ],
  'policies: the owner on every table and ductus_app for SELECT on its readable tables'
);
-- A version is immutable by its triggers, one of a mentorship's assignment
-- stays within the faculty's rule, an administrator comes and goes only
-- through the operator procedure (DAN-525), and a grant is bound to its rows
-- on insert (DAN-379); losing one must change this list.
SELECT bag_eq(
  $$ SELECT c.relname || ': ' || t.tgname || ' ' || t.tgtype::text || ' ' || t.tgenabled::text
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relnamespace = 'institution'::regnamespace AND NOT t.tgisinternal $$,
  ARRAY['assignment_version: assignment_version_immutable 27 O', 'assignment_version: assignment_version_no_truncate 34 O',
        'assignment_version: assignment_version_mentorship_rule 7 O', 'assignment_version: assignment_version_notify 5 O',
        'assignment_version: assignment_version_institution_fill 7 O',
        'assignment_version: assignment_version_work_language 7 O',
        'assignment_version: assignment_version_purpose_catalog 7 O',
        'course_enrollment_code: course_enrollment_code_institution_fill 7 O',
        'faculty_rule_version: faculty_rule_version_immutable 27 O', 'faculty_rule_version: faculty_rule_version_no_truncate 34 O',
        'faculty_rule_version: faculty_rule_version_has_event 5 O',
        'institution_role: institution_role_admin_appointed 5 O', 'institution_role: institution_role_admin_reappointed 17 O',
        'institution_role: institution_role_keeps_admin 17 O',
        'notice_acknowledgment: notice_acknowledgment_fingerprint_immutable 19 O',
        'notice_acknowledgment: notice_acknowledgment_binding_fill 7 O',
        'notice_acknowledgment: notice_acknowledgment_binding_immutable 19 O',
        'work_grant: work_grant_binding_fill 23 O',
        'notice_read: notice_read_immutable 27 O', 'notice_read: notice_read_no_truncate 34 O',
        'work_attachment: work_attachment_immutable 27 O', 'work_attachment: work_attachment_no_truncate 34 O',
        'deadline_extension: deadline_extension_immutable 27 O', 'deadline_extension: deadline_extension_no_truncate 34 O',
        'merlin_package: merlin_package_guard 27 O', 'merlin_package: merlin_package_no_truncate 34 O',
        'merlin_package_download: merlin_package_download_immutable 27 O',
        'merlin_package_download: merlin_package_download_no_truncate 34 O'],
  'triggers: immutable versions, fingerprints and bindings, the bindings derived on insert, mentorship validation, the inherited purpose catalogue, transactional notification, the institution of the parent and the operator''s administrators, all enabled'
);
SELECT bag_eq(
  $$ SELECT rolname::text FROM pg_roles
     WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND has_schema_privilege(rolname, 'institution', 'USAGE')
     UNION ALL SELECT 'public' WHERE has_schema_privilege('public', 'institution', 'USAGE') $$,
  ARRAY['ductus_app', 'ductus_identity', 'ductus_migrator'],
  'only ductus_app, the owner role and the migrator can use the institution schema'
);
SELECT bag_eq(
  $$ SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
            || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
            || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END
     FROM pg_proc p WHERE p.pronamespace = 'institution'::regnamespace $$,
  ARRAY[
    'is_plain_label(p_text text)',
    'require_actor(OUT user_id uuid, OUT institution_id uuid)',
    'actor_has_role(p_role text) definer app',
    'actor_course_role(p_course_id uuid) definer app',
    'confirm_teacher_role(p_candidate_id uuid) definer app',
    'list_teacher_candidates() definer app',
    'create_course(p_name text, p_academic_year text, p_ai_policy text) definer app',
    'create_enrollment_code(p_course_id uuid, p_valid_until timestamp with time zone) definer app',
    'revoke_enrollment_code(p_course_id uuid) definer app',
    'enroll_with_code(p_code text, OUT outcome text, OUT enrolled_course_id uuid) definer app',
    'remove_student(p_course_id uuid, p_student_id uuid) definer app',
    'allow_student_return(p_course_id uuid, p_student_id uuid) definer app',
    'revoke_teacher_role(p_teacher_id uuid) definer app',
    'teachers_without_affiliation() definer app',
    'institution_overview() definer app',
    'teacher_roles() definer app',
    'institution_courses(p_academic_year text) definer app',
    'institution_academic_years() definer app',
    'ai_policy_rank(p_ai_policy text)',
    'is_assignment_content(p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean)',
    'is_assignment_content(p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean, p_purpose_catalog_version integer)',
    'purpose_catalog_keys(p_version integer)',
    'refuse_change()',
    'actor_assignment_role(p_assignment_id uuid) definer app',
    'actor_course_ids(p_roles text[]) definer app',
    'actor_assignment_ids(p_roles text[]) definer app',
    'is_word_range(p_word_min integer, p_word_max integer)',
    'create_assignment(p_course_id uuid, p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean, p_word_min integer, p_word_max integer) definer app',
    'create_assignment(p_course_id uuid, p_request_id uuid, p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean, p_word_min integer, p_word_max integer) definer app',
    'create_assignment(p_course_id uuid, p_request_id uuid, p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean, p_word_min integer, p_word_max integer, p_purpose_catalog_version integer) definer app',
    'publish_assignment_version(p_assignment_id uuid, p_expected_version integer, p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean, p_word_min integer, p_word_max integer) definer app',
    'acknowledge_notice(p_assignment_id uuid, p_version_no integer, p_template_version integer) definer app',
    'notice_fingerprint(p_template_version integer, p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_word_min integer, p_word_max integer)',
    'refuse_acknowledgment_change()',
    'notice_acknowledgment_binding_fill()',
    'has_acknowledged_current(p_assignment_id uuid) definer app',
    'list_teacher_courses() app',
    'actor_mentorship_role(p_mentorship_id uuid) definer app',
    'check_mentorship_version() definer',
    'assignment_version_institution_fill()',
    'course_enrollment_code_institution_fill()',
    'notify_assignment_version() definer',
    'require_course_teacher(p_course_id uuid, OUT user_id uuid, OUT institution_id uuid)',
    'is_confirmed_teacher(p_user_id uuid, p_course_id uuid)',
    'set_course_holder(p_course_id uuid, p_holder_id uuid) definer app',
    'hand_over_course(p_course_id uuid, p_holder_id uuid) definer app',
    'create_seminar_group(p_course_id uuid, p_name text) definer app',
    'assign_group_teacher(p_group_id uuid, p_teacher_id uuid) definer app',
    'assign_group_student(p_group_id uuid, p_student_id uuid) definer app',
    'end_group_assignment(p_group_id uuid, p_user_id uuid) definer app',
    'actor_group_access(p_course_id uuid)',
    'require_group_manager(p_course_id uuid, p_collaborator boolean, OUT user_id uuid, OUT institution_id uuid)',
    'course_groups(p_course_id uuid) definer app',
    'can(p_action text, p_document_id text) definer app',
    'actor_group_student(p_course_id uuid, p_student_id uuid)',
    'actor_group_work(p_assignment_id uuid, p_student_id uuid)',
    'actor_course_work(p_assignment_id uuid, p_student_id uuid)',
    'is_course_team_member(p_user_id uuid, p_course_id uuid)',
    'is_course_team_teacher(p_user_id uuid, p_course_id uuid)',
    'set_course_editor(p_course_id uuid, p_editor_id uuid) definer app',
    'end_course_editor(p_course_id uuid) definer app',
    'set_team_substitution(p_course_id uuid, p_absent_id uuid, p_substitute_id uuid, p_valid_to timestamp with time zone) definer app',
    'end_team_substitution(p_substitution_id uuid) definer app',
    'team_notification_recipients(p_course_id uuid, p_student_id uuid)',
    'is_grant_action_set(p_actions text[])',
    'work_relation(p_user_id uuid, p_assignment_id uuid)',
    'grant_work_access(p_assignment_id uuid, p_student_id uuid, p_grantee_id uuid, p_kind text, p_actions text[], p_valid_from timestamp with time zone, p_valid_to timestamp with time zone) definer app',
    'revoke_work_access(p_grant_id uuid) definer app',
    'grant_can(p_action text, p_document_id text) definer app',
    'work_grant_binding_fill()',
    'lock_teacher_role(p_user_id uuid)',
    'request_mentorship(p_teacher_id uuid, p_work_type text) definer app',
    'withdraw_mentorship_request(p_request_id uuid) definer app',
    'approve_mentorship_request(p_request_id uuid) definer app',
    'decline_mentorship_request(p_request_id uuid, p_reason text) definer app',
    'refuse_rule_version_change()',
    'check_rule_version_event() definer',
    'publish_faculty_rule_version(p_work_type text, p_expected_version integer, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean) definer app',
    'require_admin_request(p_user_id uuid, p_request_ref text)',
    'appoint_institution_admin(p_user_id uuid, p_request_ref text)',
    'revoke_institution_admin(p_user_id uuid, p_request_ref text)',
    'check_admin_appointment() definer',
    'check_last_admin() definer',
    'is_work_language(p_language text)',
    'assignment_version_work_language() definer',
    'assignment_version_purpose_catalog() definer',
    'lock_assignment_teacher(p_assignment_id uuid)',
    'lock_assignment_student(p_assignment_id uuid, p_student_id uuid)',
    'set_assignment_work_language(p_assignment_id uuid, p_expected_version integer, p_work_language text) definer app',
    'work_language(p_assignment_id uuid, p_student_id uuid) definer app',
    'set_work_language(p_assignment_id uuid, p_student_id uuid, p_work_language text) definer app',
    'work_accommodation(p_assignment_id uuid, p_student_id uuid) definer app',
    'set_work_accommodation(p_assignment_id uuid, p_marked boolean) definer app',
    'check_admin_event_actor() definer',
    'admin_appoint_admin(p_user_id uuid) definer app',
    'refuse_notice_read_change()',
    'mark_notice_read(p_assignment_id uuid) definer app',
    'student_assignments() definer app',
    'admin_create_course(p_name text, p_academic_year text, p_ai_policy text, p_holder_id uuid) definer app',
    'work_source_record_valid(p_id uuid, p_record jsonb)',
    'work_source_access(p_assignment_id uuid, p_student_id uuid)',
    'save_work_source(p_assignment_id uuid, p_record jsonb, p_doi text, p_isbn text, p_undated boolean) definer app',
    'delete_work_source(p_assignment_id uuid, p_source_id uuid) definer app',
    'work_sources(p_assignment_id uuid, p_student_id uuid) definer app',
    'save_teacher_work_source(p_assignment_id uuid, p_student_id uuid, p_record jsonb, p_requirement text, p_doi text, p_isbn text, p_undated boolean) definer app',
    'delete_teacher_work_source(p_assignment_id uuid, p_student_id uuid, p_source_id uuid) definer app',
    'refuse_work_attachment_change()',
    'add_work_attachment(p_assignment_id uuid, p_media_type text, p_byte_size integer, p_sha256 text, p_storage_ref text, p_pixel_width integer, p_pixel_height integer) definer app',
    'work_attachments(p_assignment_id uuid, p_student_id uuid) definer app',
    'read_work_attachment(p_attachment_id uuid) definer app',
    'source_proof_text_valid(p_text text, p_max integer, p_lines boolean)',
    'add_source_proof(p_assignment_id uuid, p_source_id uuid, p_page text, p_note text, p_image bytea) definer app',
    'source_proofs(p_assignment_id uuid, p_source_id uuid, p_student_id uuid) definer app',
    'read_source_proof_image(p_assignment_id uuid, p_source_id uuid, p_proof_id uuid, p_student_id uuid) definer app',
    'refuse_deadline_extension_change()',
    'effective_due_at(p_assignment_id uuid, p_student_id uuid)',
    'extend_assignment_deadline(p_assignment_id uuid, p_student_id uuid, p_due_at timestamp with time zone, p_reason_id text) definer app',
    'deadline_extensions(p_assignment_id uuid) definer app',
    'guard_merlin_package()',
    'refuse_merlin_package_download_change()',
    'merlin_package_visible(p_assignment_id uuid, p_student_ids uuid[])',
    'own_merlin_package(p_assignment_id uuid, p_package_id uuid)',
    'merlin_package_state(p_state text, p_expires_at timestamp with time zone)',
    'request_merlin_package(p_assignment_id uuid, p_request_key text) definer app',
    'complete_merlin_package(p_assignment_id uuid, p_package_id uuid, p_content bytea, p_student_ids uuid[]) definer app',
    'fail_merlin_package(p_assignment_id uuid, p_package_id uuid, p_code text) definer app',
    'merlin_package_status(p_assignment_id uuid, p_package_id uuid) definer app',
    'download_merlin_package(p_assignment_id uuid, p_package_id uuid) definer app',
    'consultation_slots(p_document_id text) definer app',
    'request_consultation_slot(p_document_id text, p_starts_at timestamp with time zone) definer app',
    'act_on_consultation_slot(p_document_id text, p_slot_id uuid, p_action text, p_starts_at timestamp with time zone) definer app'
  ],
  'functions: exact signatures, which are SECURITY DEFINER and which ductus_app may call'
);
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || p.proname
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_app', 'ductus_identity')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN pg_proc p
     WHERE p.pronamespace = 'institution'::regnamespace AND has_function_privilege(r.rolname, p.oid, 'EXECUTE') $$,
  'no other role, nor PUBLIC, may execute an institution function'
);
SELECT is_empty(
  $$ SELECT p.proname FROM pg_proc p
     WHERE p.pronamespace = 'institution'::regnamespace
       AND (p.proowner <> 'ductus_identity'::regrole OR NOT coalesce('search_path=""' = ANY (p.proconfig), false)) $$,
  'every institution function belongs to the NOLOGIN owner role and pins an empty search_path'
);

-- 1b. SRV-20: the submission state by assignment lives in schema app; its
-- reader app.submission_state_of is never the web role's. One cell per actor
-- of the fixture on Z1 of K1 (no submission in this fixture, so a student of
-- the course reads none) and on Z3 of fak-b.
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || f
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_identity', 'ductus_evidence')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN unnest(ARRAY['app.submission_state_of(uuid,uuid)']) f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE') $$,
  'SRV-20: only its owner and the identity role execute app.submission_state_of, never ductus_app'
);
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || f
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_app', 'ductus_identity')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN unnest(ARRAY['app.my_submission_state(uuid)', 'app.my_assignment_requirements(uuid)',
                             'app.teacher_submission_state(uuid,uuid)']) f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE') $$,
  'SRV-20: only ductus_app and the owner execute the three state RPCs'
);
SELECT is(
  pg_temp.ask(c.actor, format('SELECT state FROM app.my_submission_state(%s)', c.assignment)), c.state,
  format('SRV-20: %s reads the own submission state on %s: %s', c.actor, c.assignment, c.state)
)
FROM (VALUES
  ('ana', '{z1}', 'none'), ('dora', '{z1}', 'none'), ('vesna', '{z1}', 'not_found'), ('marko', '{z1}', 'not_found'),
  ('boris', '{z1}', 'not_found'), ('iva', '{z1}', 'not_found'), ('nina', '{z1}', 'not_found'),
  ('tomo', '{z1}', 'not_found'), ('tomo', '{z3}', 'none'), ('ana', '{z3}', 'not_found'), ('petra', '{z3}', 'not_found')
) AS c (actor, assignment, state);
SELECT is(
  pg_temp.ask(c.actor, format('SELECT outcome FROM app.my_assignment_requirements(%s)', c.assignment)), c.outcome,
  format('SRV-20: %s reads the requirements of %s: %s', c.actor, c.assignment, c.outcome)
)
FROM (VALUES
  ('ana', '{z1}', 'found'), ('dora', '{z1}', 'found'), ('vesna', '{z1}', 'not_found'), ('marko', '{z1}', 'not_found'),
  ('boris', '{z1}', 'not_found'), ('tomo', '{z1}', 'not_found'), ('tomo', '{z3}', 'found'), ('petra', '{z3}', 'not_found')
) AS c (actor, assignment, outcome);
SELECT is(
  coalesce(substr(pg_temp.ask(c.actor, format('SELECT state FROM app.teacher_submission_state(%s, %s)', c.assignment, c.student)),
                  1, 5), 'NULL'), c.state,
  format('SRV-20: %s reads the state of %s on %s: %s', c.actor, c.student, c.assignment, c.state)
)
FROM (VALUES
  ('vesna', '{z1}', '{ana}', 'none'), ('vesna', '{z1}', '{dora}', 'none'), ('marko', '{z1}', '{ana}', 'ZD403'),
  ('ana', '{z1}', '{ana}', 'ZD403'), ('dora', '{z1}', '{ana}', 'ZD403'), ('boris', '{z1}', '{ana}', 'ZD403'),
  ('iva', '{z1}', '{ana}', 'ZD403'), ('nina', '{z1}', '{ana}', 'ZD403'), ('petra', '{z1}', '{ana}', 'ZD403'),
  ('petra', '{z3}', '{tomo}', 'none'), ('vesna', '{z3}', '{tomo}', 'ZD403'), ('tomo', '{z3}', '{tomo}', 'ZD403'),
  ('vesna', '{z1}', '{boris}', 'ZD403'), ('vesna', '{z1}', '{tomo}', 'ZD403')
) AS c (actor, assignment, student, state);
SELECT is(
  substr(pg_temp.ask('ana', 'SELECT state FROM app.submission_state_of({z1}, {ana})'), 1, 5), '42501',
  'SRV-20: the web role cannot call the reader of the state'
);

-- 1c. SRV-21: a student's notes (evidence.submission_note) only through the
-- two RPCs; the writer and the reader of the table are never the web role's.
-- One cell per actor of the fixture on Z1 of K1 and Z3 of fak-b; the rest of
-- the matrix (seminar group, collaborator, mentor, removal, append-only) is
-- in 147-submission-note.sql.
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || f
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_identity', 'ductus_evidence')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN unnest(ARRAY['app.submission_note_append(uuid,uuid,text)', 'app.submission_notes_of(uuid,uuid)']) f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE') $$,
  'SRV-21: only their owner and the identity role execute the writer and the reader of the notes'
);
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || f
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_app', 'ductus_identity')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN unnest(ARRAY['app.add_submission_note(uuid,text)', 'app.submission_notes(uuid,uuid)']) f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE') $$,
  'SRV-21: only ductus_app and the owner execute the two note RPCs'
);
SELECT is(
  substr(pg_temp.ask(c.actor, format('SELECT ''ok'' FROM app.add_submission_note(%s, %L)', c.assignment, 'Napomena ' || c.actor)), 1, 5),
  c.outcome, format('SRV-21: %s adds a note on %s: %s', c.actor, c.assignment, c.outcome)
)
FROM (VALUES
  ('ana', '{z1}', 'ok'), ('dora', '{z1}', 'ok'), ('vesna', '{z1}', 'ZD403'), ('marko', '{z1}', 'ZD403'),
  ('boris', '{z1}', 'ZD403'), ('iva', '{z1}', 'ZD403'), ('tomo', '{z1}', 'ZD403'), ('tomo', '{z3}', 'ok'),
  ('petra', '{z3}', 'ZD403')
) AS c (actor, assignment, outcome);
SELECT is(
  substr(pg_temp.ask('ana', format('SELECT ''ok'' FROM app.add_submission_note({z1}, %L)', repeat('a', 601))), 1, 5), 'ZD422',
  'SRV-21: a note of 601 characters is refused'
);
SELECT is(
  coalesce(substr(pg_temp.ask(c.actor, format('SELECT string_agg(text, ''|'') FROM app.submission_notes(%s, %s)',
                                              c.assignment, c.student)), 1, 13), 'NULL'), c.result,
  format('SRV-21: %s reads the notes of %s on %s: %s', c.actor, c.student, c.assignment, c.result)
)
FROM (VALUES
  ('ana', '{z1}', '{ana}', 'Napomena ana'), ('vesna', '{z1}', '{ana}', 'Napomena ana'),
  ('dora', '{z1}', '{ana}', 'ZD403: forbid'), ('marko', '{z1}', '{ana}', 'ZD403: forbid'),
  ('iva', '{z1}', '{ana}', 'ZD403: forbid'), ('petra', '{z3}', '{tomo}', 'Napomena tomo'),
  ('vesna', '{z3}', '{tomo}', 'ZD403: forbid')
) AS c (actor, assignment, student, result);

-- 1d. SRV-28: the decline of a mentorship request and the overview of an
-- assignment, one cell per actor; the rest of their matrix (states, reason,
-- the trail; collaborator, groups, receipts) is in 104-mentorship-request.sql
-- and 086-assignment-submissions.sql.
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || f
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_app', 'ductus_identity')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN unnest(ARRAY['institution.decline_mentorship_request(uuid,text)', 'app.assignment_overview(uuid)',
                             'app.teacher_course_assignment_ids(uuid)']) f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE') $$,
  'only ductus_app and the owner execute the decline, the overview and the course assignment ids'
);
SELECT is(
  pg_temp.ask(c.actor, format('SELECT count(*)::text FROM app.assignment_overview(%s)', c.assignment)), c.rows,
  format('SRV-28: %s reads the overview of %s: %s', c.actor, c.assignment, c.rows)
)
FROM (VALUES
  ('vesna', '{z1}', '2'), ('marko', '{z1}', '0'), ('ana', '{z1}', '0'), ('dora', '{z1}', '0'), ('boris', '{z1}', '0'),
  ('iva', '{z1}', '0'), ('nina', '{z1}', '0'), ('petra', '{z1}', '0'), ('petra', '{z3}', '1')
) AS c (actor, assignment, rows);
SELECT is(
  pg_temp.ask(c.actor, format('SELECT count(*) FROM app.teacher_course_assignment_ids(%s)', c.course)), c.result,
  format('SRV-29: %s reads only the course assignment ids permitted for %s', c.actor, c.course)
)
FROM (VALUES
  ('vesna', '{k1}', '1'), ('marko', '{k1}', '0'), ('ana', '{k1}', '0'), ('iva', '{k1}', '0'),
  ('nina', '{k1}', '0'), ('petra', '{k1}', '0'), ('vesna', '{nobody}', '0'),
  ('closed', '{k1}', 'ZD401: not authenticated')
) AS c (actor, course, result);
INSERT INTO ref VALUES ('rq', pg_temp.ask('ana', $$ SELECT institution.request_mentorship({vesna}, 'bachelor_thesis') $$));
SELECT matches((SELECT val FROM ref WHERE name = 'rq'), '^[0-9a-f-]{36}$', 'SRV-28: Ana asks Vesna to mentor a thesis');
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || f
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_app', 'ductus_identity')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN unnest(ARRAY['app.teacher_mentorship_requests()', 'app.approve_mentorship_request_with_work(uuid)']) f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE') $$,
  'SRV-31: the application role and owner execute the two RPCs'
);
SELECT ok(has_function_privilege('ductus_app', 'app.teacher_mentorship_requests()', 'EXECUTE')
       AND has_function_privilege('ductus_app', 'app.approve_mentorship_request_with_work(uuid)', 'EXECUTE'),
  'SRV-31: the application role can call both RPCs');
SELECT is(
  pg_temp.ask(c.actor, $$ SELECT count(*) FROM app.teacher_mentorship_requests() WHERE request_id = {rq} $$),
  c.rows, 'SRV-31: request visibility for ' || c.actor
)
FROM (VALUES ('vesna', '1'), ('marko', '0'), ('ana', '0'), ('iva', '0'), ('petra', '0'), ('anon', '0')) AS c (actor, rows);
SELECT is(
  left(pg_temp.ask(c.actor, $$ SELECT app.approve_mentorship_request_with_work({rq}) $$), 5),
  c.code, 'SRV-31: approval refused for ' || c.actor
)
FROM (VALUES ('marko', 'ZD403'), ('ana', 'ZD403'), ('iva', 'ZD403'), ('petra', 'ZD403'),
             ('tomo', 'ZD403'), ('anon', 'ZD401')) AS c (actor, code);
SELECT is(
  substr(pg_temp.ask(c.actor, $$ SELECT institution.decline_mentorship_request({rq}, NULL)::text $$), 1, 5), c.outcome,
  format('SRV-28: %s declines Ana''s request to Vesna: %s', c.actor, c.outcome)
)
FROM (VALUES (1, 'marko', 'ZD403'), (2, 'ana', 'ZD403'), (3, 'iva', 'ZD403'), (4, 'petra', 'ZD403'),
             (5, 'tomo', 'ZD403'), (6, 'vesna', 'true')) AS c (n, actor, outcome)
ORDER BY c.n;

-- 1e. SRV-7B: the sources of a work (institution.work_source) only through
-- its three RPCs; the web role has no privilege or policy on the table. One
-- cell per actor on Z1 of K1 and Z3 of fak-b; the rest of the matrix (record
-- shape, DOI and ISBN, the bound, a teacher's source, seminar group,
-- collaborator, mentor) is in 149-work-source.sql.
CREATE FUNCTION pg_temp.source_json() RETURNS text LANGUAGE sql AS $$
  SELECT '{"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "type": "book", "year": 2024, '
         '"authors": [{"kind": "person", "family": "Izmišljenić", "given": "Mara"}], '
         '"title": "Kućno kompostiranje", "place": "Zagreb", "publisher": "Izmišljena naklada"}'
$$;
SELECT is(
  substr(pg_temp.ask(c.actor, format('SELECT ''ok'' FROM institution.save_work_source(%s, %L::jsonb)',
                                     c.assignment, pg_temp.source_json())), 1, 5),
  c.outcome, format('SRV-7B: %s saves a source on %s: %s', c.actor, c.assignment, c.outcome)
)
FROM (VALUES
  ('ana', '{z1}', 'ok'), ('dora', '{z1}', 'ok'), ('vesna', '{z1}', 'ZD403'), ('marko', '{z1}', 'ZD403'),
  ('iva', '{z1}', 'ZD403'), ('boris', '{z1}', 'ZD403'), ('nina', '{z1}', 'ZD403'), ('tomo', '{z1}', 'ZD403'),
  ('lea', '{z1}', 'ZD403'), ('tomo', '{z3}', 'ok'), ('petra', '{z3}', 'ZD403'), ('anon', '{z1}', 'ZD401')
) AS c (actor, assignment, outcome);
SELECT is(
  substr(pg_temp.ask(c.actor, format('SELECT count(*)::text FROM institution.work_sources(%s, %s)',
                                     c.assignment, c.student)), 1, 5), c.result,
  format('SRV-7B: %s reads the sources of %s on %s: %s', c.actor, c.student, c.assignment, c.result)
)
FROM (VALUES
  ('ana', '{z1}', 'NULL', '1'), ('ana', '{z1}', '{ana}', '1'), ('vesna', '{z1}', '{ana}', '1'),
  ('dora', '{z1}', '{ana}', 'ZD403'), ('marko', '{z1}', '{ana}', 'ZD403'), ('iva', '{z1}', '{ana}', 'ZD403'),
  ('boris', '{z1}', '{ana}', 'ZD403'), ('petra', '{z1}', '{ana}', 'ZD403'), ('petra', '{z3}', '{tomo}', '1'),
  ('vesna', '{z3}', '{tomo}', 'ZD403'), ('anon', '{z1}', '{ana}', 'ZD401')
) AS c (actor, assignment, student, result);
SELECT is(
  substr(pg_temp.ask(c.actor, $$ SELECT institution.delete_work_source({z1}, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text $$), 1, 5),
  c.outcome, format('SRV-7B: %s removes the source on Z1: %s', c.actor, c.outcome)
)
FROM (VALUES (1, 'vesna', 'ZD403'), (2, 'marko', 'ZD403'), (3, 'dora', 'true'), (4, 'dora', 'false'))
  AS c (n, actor, outcome)
ORDER BY c.n;
SELECT is(
  substr(pg_temp.ask(c.actor, format(
    'SELECT ''ok'' FROM institution.save_teacher_work_source(%s, %s, %L::jsonb, ''required'')',
    c.assignment, c.student, replace(pg_temp.source_json(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                                     'cccccccc-cccc-4ccc-8ccc-cccccccccccc'))), 1, 5),
  c.outcome, format('SRV-7B: %s adds a required source to the work of %s on %s: %s', c.actor, c.student, c.assignment, c.outcome)
)
FROM (VALUES
  ('vesna', '{z1}', '{ana}', 'ok'), ('marko', '{z1}', '{ana}', 'ZD403'), ('ana', '{z1}', '{ana}', 'ZD403'),
  ('dora', '{z1}', '{ana}', 'ZD403'), ('iva', '{z1}', '{ana}', 'ZD403'), ('boris', '{z1}', '{ana}', 'ZD403'),
  ('nina', '{z1}', '{ana}', 'ZD403'), ('petra', '{z1}', '{ana}', 'ZD403'), ('petra', '{z3}', '{tomo}', 'ok'),
  ('vesna', '{z3}', '{tomo}', 'ZD403'), ('anon', '{z1}', '{ana}', 'ZD401')
) AS c (actor, assignment, student, outcome);
SELECT is(
  substr(pg_temp.ask(c.actor, $$ SELECT institution.delete_teacher_work_source({z1}, {ana}, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')::text $$), 1, 5),
  c.outcome, format('SRV-7B: %s removes the required source of Ana on Z1: %s', c.actor, c.outcome)
)
FROM (VALUES (1, 'ana', 'ZD403'), (2, 'marko', 'ZD403'), (3, 'vesna', 'true'), (4, 'vesna', 'false'))
  AS c (n, actor, outcome)
ORDER BY c.n;

-- 1f. SRV-9A: the versions of a work only through app.read_work_versions; its
-- reader of the evidence rows is never the web role's. This fixture has no
-- work, so every signed-in actor gets the one answer for a missing document;
-- the owner, the teacher, the cut, the pages and the access log are in
-- 152-work-versions.sql.
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || f
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_app', 'ductus_identity')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN unnest(ARRAY['app.read_work_versions(text,bigint)']) f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE')
     UNION ALL
     SELECT r.rolname || ' may execute ' || f
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_identity', 'ductus_evidence')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN unnest(ARRAY['app.work_version_rows(text,bigint)']) f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE') $$,
  'SRV-9A: only ductus_app and the owner execute the read; only the identity role and the owner the helper'
);
SELECT is(
  substr(pg_temp.ask(c.actor, $$ SELECT string_agg(outcome, ',') FROM app.read_work_versions('doc-nema') $$), 1, 9),
  c.outcome, format('SRV-9A: %s reads the versions of a missing work: %s', c.actor, c.outcome)
)
FROM (VALUES
  ('ana', 'not_found'), ('dora', 'not_found'), ('vesna', 'not_found'), ('marko', 'not_found'),
  ('iva', 'not_found'), ('boris', 'not_found'), ('nina', 'not_found'), ('tomo', 'not_found'),
  ('lea', 'not_found'), ('petra', 'not_found'), ('anon', 'ZD401: no')
) AS c (actor, outcome);

-- 1g. SRV-10B: the attachments of a work (institution.work_attachment) only
-- through its three RPCs; the web role has no privilege or policy on the
-- table. One cell per actor on Z1 of K1 and Z3 of fak-b; the rest (shape,
-- bounds, the same bytes twice, append-only, seminar group, collaborator,
-- mentor) is in 156-work-attachment.sql.
CREATE FUNCTION pg_temp.attach(p_actor text, p_assignment text, p_sha text) RETURNS text
LANGUAGE sql AS $$
  SELECT substr(pg_temp.ask(p_actor, format(
    'SELECT ''ok'' FROM institution.add_work_attachment(%s, ''image/png'', 2048, %L, %L, 640, 480)',
    p_assignment, p_sha, 'privitci/' || p_sha)), 1, 5)
$$;
SELECT is(pg_temp.attach(c.actor, c.assignment, repeat(c.digit, 64)), c.outcome,
  format('SRV-10B: %s adds an attachment on %s: %s', c.actor, c.assignment, c.outcome))
FROM (VALUES
  ('ana', '{z1}', 'a', 'ok'), ('dora', '{z1}', 'b', 'ok'), ('vesna', '{z1}', 'c', 'ZD403'),
  ('marko', '{z1}', 'c', 'ZD403'), ('iva', '{z1}', 'c', 'ZD403'), ('boris', '{z1}', 'c', 'ZD403'),
  ('nina', '{z1}', 'c', 'ZD403'), ('tomo', '{z1}', 'c', 'ZD403'), ('lea', '{z1}', 'c', 'ZD403'),
  ('tomo', '{z3}', 'd', 'ok'), ('petra', '{z3}', 'c', 'ZD403'), ('anon', '{z1}', 'c', 'ZD401')
) AS c (actor, assignment, digit, outcome);
SELECT is(
  substr(pg_temp.ask(c.actor, format('SELECT count(*)::text FROM institution.work_attachments(%s, %s)',
                                     c.assignment, c.student)), 1, 5), c.result,
  format('SRV-10B: %s reads the attachments of %s on %s: %s', c.actor, c.student, c.assignment, c.result)
)
FROM (VALUES
  ('ana', '{z1}', 'NULL', '1'), ('ana', '{z1}', '{ana}', '1'), ('vesna', '{z1}', '{ana}', '1'),
  ('dora', '{z1}', '{ana}', 'ZD403'), ('marko', '{z1}', '{ana}', 'ZD403'), ('iva', '{z1}', '{ana}', 'ZD403'),
  ('boris', '{z1}', '{ana}', 'ZD403'), ('petra', '{z1}', '{ana}', 'ZD403'), ('petra', '{z3}', '{tomo}', '1'),
  ('vesna', '{z3}', '{tomo}', 'ZD403'), ('anon', '{z1}', '{ana}', 'ZD401')
) AS c (actor, assignment, student, result);
INSERT INTO ref VALUES ('att_ana', pg_temp.ask('ana', $$ SELECT id::text FROM institution.work_attachments({z1}) $$)),
                       ('att_tomo', pg_temp.ask('tomo', $$ SELECT id::text FROM institution.work_attachments({z3}) $$));
SELECT is(
  substr(pg_temp.ask(c.actor, format('SELECT sha256 FROM institution.read_work_attachment(%s)', c.att)), 1, 5),
  c.result, format('SRV-10B: %s reads attachment %s by id: %s', c.actor, c.att, c.result)
)
FROM (VALUES
  ('ana', '{att_ana}', 'aaaaa'), ('vesna', '{att_ana}', 'aaaaa'), ('dora', '{att_ana}', 'ZD403'),
  ('marko', '{att_ana}', 'ZD403'), ('iva', '{att_ana}', 'ZD403'), ('boris', '{att_ana}', 'ZD403'),
  ('nina', '{att_ana}', 'ZD403'), ('lea', '{att_ana}', 'ZD403'), ('petra', '{att_ana}', 'ZD403'),
  ('tomo', '{att_ana}', 'ZD403'), ('petra', '{att_tomo}', 'ddddd'), ('vesna', '{att_tomo}', 'ZD403'),
  ('ana', '''eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee''', 'ZD403'), ('anon', '{att_ana}', 'ZD401')
) AS c (actor, att, result);

-- 1h. SRV-1102: the proofs of a source (institution.source_proof) only
-- through its three RPCs; the web role has no privilege or policy on the
-- table. One cell per actor on source A of Z1 of K1 and of Z3 of fak-b; the
-- rest (shape, a whole PDF, bounds, the removed source, seminar group,
-- mentor) is in 160-source-proof-access.sql.
INSERT INTO ref VALUES ('pf_src', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
SELECT is(substr(pg_temp.ask(c.actor, format('SELECT ''ok'' FROM institution.save_work_source(%s, %L::jsonb)',
                                             c.assignment, pg_temp.source_json())), 1, 5), 'ok',
  format('SRV-1102 fixture: %s has source A on %s', c.actor, c.assignment))
FROM (VALUES ('ana', '{z1}'), ('tomo', '{z3}')) AS c (actor, assignment);
SELECT is(
  substr(pg_temp.ask(c.actor, format(
    'SELECT ''ok'' FROM institution.add_source_proof(%s, {pf_src}, ''14'', NULL, ''\xffd8ffe0ffd9''::bytea)',
    c.assignment)), 1, 5),
  c.outcome, format('SRV-1102: %s attaches a proof to source A on %s: %s', c.actor, c.assignment, c.outcome)
)
FROM (VALUES
  ('ana', '{z1}', 'ok'), ('dora', '{z1}', 'ZD403'), ('vesna', '{z1}', 'ZD403'), ('marko', '{z1}', 'ZD403'),
  ('iva', '{z1}', 'ZD403'), ('boris', '{z1}', 'ZD403'), ('nina', '{z1}', 'ZD403'), ('tomo', '{z1}', 'ZD403'),
  ('lea', '{z1}', 'ZD403'), ('tomo', '{z3}', 'ok'), ('petra', '{z3}', 'ZD403'), ('anon', '{z1}', 'ZD401')
) AS c (actor, assignment, outcome);
SELECT is(
  substr(pg_temp.ask(c.actor, format('SELECT count(*)::text FROM institution.source_proofs(%s, {pf_src}, %s)',
                                     c.assignment, c.student)), 1, 5), c.result,
  format('SRV-1102: %s reads the proofs of %s on %s: %s', c.actor, c.student, c.assignment, c.result)
)
FROM (VALUES
  ('ana', '{z1}', 'NULL', '1'), ('vesna', '{z1}', '{ana}', '1'), ('dora', '{z1}', '{ana}', 'ZD403'),
  ('marko', '{z1}', '{ana}', 'ZD403'), ('iva', '{z1}', '{ana}', 'ZD403'), ('boris', '{z1}', '{ana}', 'ZD403'),
  ('nina', '{z1}', '{ana}', 'ZD403'), ('petra', '{z1}', '{ana}', 'ZD403'), ('lea', '{z1}', '{ana}', 'ZD403'),
  ('petra', '{z3}', '{tomo}', '1'), ('vesna', '{z3}', '{tomo}', 'ZD403'), ('anon', '{z1}', '{ana}', 'ZD401')
) AS c (actor, assignment, student, result);
INSERT INTO ref VALUES ('pf_ana', pg_temp.ask('ana', $$ SELECT id::text FROM institution.source_proofs({z1}, {pf_src}) $$));
SELECT is(
  substr(pg_temp.ask(c.actor, format(
    'SELECT sha256 FROM institution.read_source_proof_image({z1}, {pf_src}, {pf_ana}, %s)', c.student)), 1, 5),
  c.result, format('SRV-1102: %s reads the image of Ana''s proof: %s', c.actor, c.result)
)
FROM (VALUES
  ('ana', 'NULL', left(encode(sha256('\xffd8ffe0ffd9'::bytea), 'hex'), 5)),
  ('vesna', '{ana}', left(encode(sha256('\xffd8ffe0ffd9'::bytea), 'hex'), 5)),
  ('dora', '{ana}', 'ZD403'), ('dora', 'NULL', 'ZD403'), ('marko', '{ana}', 'ZD403'), ('iva', '{ana}', 'ZD403'),
  ('petra', '{ana}', 'ZD403'), ('lea', '{ana}', 'ZD403'), ('anon', '{ana}', 'ZD401')
) AS c (actor, student, result);
-- 1i. SRV-1108: deadline extensions (institution.deadline_extension) only
-- through their RPCs; the web role has no privilege or policy on the table.
-- One cell per actor on Z1 of K1; the rest (scope, effective deadline,
-- reasons, privacy of the reason, append-only) is in 166-deadline-extension-access.sql.
SELECT is(
  substr(pg_temp.ask(c.actor, format(
    'SELECT ''ok'' FROM institution.extend_assignment_deadline({z1}, {ana}, now() + interval %L, ''justified'')',
    c.days || ' days')), 1, 5), c.outcome,
  format('SRV-1108: %s extends the deadline of Ana on Z1: %s', c.actor, c.outcome))
FROM (VALUES
  ('vesna', 400, 'ok'), ('marko', 401, 'ZD403'), ('iva', 401, 'ZD403'), ('ana', 401, 'ZD403'),
  ('dora', 401, 'ZD403'), ('boris', 401, 'ZD403'), ('nina', 401, 'ZD403'), ('tomo', 401, 'ZD403'),
  ('lea', 401, 'ZD403'), ('petra', 401, 'ZD403'), ('anon', 401, 'ZD401')
) AS c (actor, days, outcome);
SELECT is(
  substr(pg_temp.ask(c.actor, 'SELECT count(*)::text FROM institution.deadline_extensions({z1})'), 1, 5), c.result,
  format('SRV-1108: %s lists the extensions of Z1: %s', c.actor, c.result))
FROM (VALUES ('vesna', '1'), ('marko', 'ZD403'), ('ana', 'ZD403'), ('petra', 'ZD403'), ('anon', 'ZD401'))
  AS c (actor, result);

-- 1i. SRV-1108C: the effective deadline through app.student_effective_due_at
-- only for a student of the assignment, and only the caller's own (Ana's was
-- extended in 1h); null for everyone else. The rest is in
-- 167-submission-effective-due.sql.
SELECT is(
  coalesce(pg_temp.ask(c.actor, 'SELECT (app.student_effective_due_at({z1}) - now())::text'), 'null'), c.result,
  format('SRV-1108C: %s reads the own effective deadline of Z1: %s', c.actor, c.result))
FROM (VALUES
  ('ana', '400 days'), ('dora', '30 days'), ('vesna', 'null'), ('marko', 'null'), ('iva', 'null'),
  ('boris', 'null'), ('nina', 'null'), ('tomo', 'null'), ('lea', 'null'), ('petra', 'null'), ('anon', 'null')
) AS c (actor, result);

-- 1j. SRV-1110: the Merlin package (institution.merlin_package and the record
-- of its downloads, institution.merlin_package_download) only through their
-- RPCs; the web role has no privilege or policy on either table. One cell per
-- actor asking for the package of Z1 of K1; building, reading, downloading,
-- expiry and the append-only record are in 167-merlin-package-access.sql.
SELECT is(
  substr(pg_temp.ask(c.actor, 'SELECT state FROM institution.request_merlin_package({z1}, ''kljuc-matrica'')'), 1, 6),
  c.result, format('SRV-1110: %s asks for the Merlin package of Z1: %s', c.actor, c.result))
FROM (VALUES
  ('vesna', 'queued'), ('marko', 'ZD403:'), ('iva', 'ZD403:'), ('ana', 'ZD403:'), ('dora', 'ZD403:'),
  ('boris', 'ZD403:'), ('nina', 'ZD403:'), ('tomo', 'ZD403:'), ('lea', 'ZD403:'), ('petra', 'ZD403:'),
  ('anon', 'ZD401:')
) AS c (actor, result);

-- SRV-1103: actor-level cases are in 161-work-milestone-access.sql.
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || f
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_app', 'ductus_identity')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN unnest(ARRAY['app.read_work_milestones(text)', 'app.set_work_milestone_due(text,uuid,timestamptz)']) f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE') $$,
  'SRV-1103: only ductus_app and the owner execute the milestone RPCs'
);

-- 2. Role by table by operation, as it is migrated. Each cell runs the
-- statement as that role and reports why it stopped.
CREATE FUNCTION pg_temp.probe(p_role text, p_actor text, p_table text, p_op text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_column text;
  v_result text;
BEGIN
  SELECT attname INTO STRICT v_column FROM pg_attribute
   WHERE attrelid = ('institution.' || p_table)::regclass AND attnum = 1;
  v_result := pg_temp.ask_as(p_role, p_actor, CASE p_op
    WHEN 'SELECT' THEN format('SELECT ''rows='' || count(*) FROM institution.%I', p_table)
    WHEN 'INSERT' THEN format(
      'WITH x AS (INSERT INTO institution.%I DEFAULT VALUES RETURNING 1) SELECT ''rows='' || count(*) FROM x', p_table)
    WHEN 'UPDATE' THEN format(
      'WITH x AS (UPDATE institution.%I SET %I = DEFAULT RETURNING 1) SELECT ''rows='' || count(*) FROM x', p_table, v_column)
    WHEN 'DELETE' THEN format(
      'WITH x AS (DELETE FROM institution.%I RETURNING 1) SELECT ''rows='' || count(*) FROM x', p_table)
  END);
  RETURN CASE
    WHEN v_result LIKE '42501: permission denied for schema %' THEN 'no schema privilege'
    WHEN v_result LIKE '42501: permission denied for table %' THEN 'no table privilege'
    WHEN v_result LIKE '42501: new row violates row-level security policy %' THEN 'refused by RLS'
    ELSE v_result
  END;
END
$$;

CREATE TEMP TABLE cell AS
SELECT r.role, t.tbl, o.op, r.n AS role_n, t.n AS tbl_n, o.n AS op_n
FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence',
                  'ductus_migrator', 'ductus_test_stranger']) WITH ORDINALITY AS r (role, n)
CROSS JOIN unnest(ARRAY['institution_settings', 'institution_role', 'course', 'course_enrollment_code',
                        'course_member', 'enrollment_attempt', 'assignment', 'assignment_version',
                        'notice_acknowledgment', 'faculty_work_rule', 'mentorship', 'notification',
                        'course_holder', 'seminar_group', 'seminar_group_teacher', 'seminar_group_member',
                        'course_editor', 'team_substitution', 'work_grant', 'mentorship_request',
                        'faculty_rule_version', 'work_language_override', 'work_accommodation',
                        'notice_read', 'work_source', 'work_attachment', 'source_proof', 'deadline_extension',
                        'merlin_package', 'merlin_package_download', 'consultation_slot', 'work_milestone', 'work_milestone_deadline']) WITH ORDINALITY AS t (tbl, n)
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) WITH ORDINALITY AS o (op, n);

SELECT is(
  pg_temp.probe(role, 'anon', tbl, op),
  CASE WHEN role = 'ductus_app' AND op = 'SELECT' AND tbl NOT IN ('enrollment_attempt', 'faculty_work_rule', 'notification', 'work_source', 'work_attachment', 'source_proof', 'deadline_extension', 'merlin_package', 'merlin_package_download', 'consultation_slot', 'work_milestone', 'work_milestone_deadline') THEN 'rows=0'
       WHEN role IN ('ductus_app', 'ductus_migrator') THEN 'no table privilege'
       ELSE 'no schema privilege' END,
  format('%s: %s on %s', role, op, tbl)
)
FROM cell ORDER BY role_n, tbl_n, op_n;

-- The owner role holds every privilege and, with RLS forced, reads through
-- its own policy. It cannot log in; only the functions act as it.
SELECT ok(
  has_table_privilege('ductus_identity', ('institution.' || tbl)::regclass, op),
  format('ductus_identity (owner): %s on %s', op, tbl)
)
FROM cell WHERE role = 'ductus_app' ORDER BY tbl_n, op_n;
SELECT is(
  pg_temp.ask_as('ductus_identity', 'anon', 'SELECT count(*) FROM institution.course'), '3',
  'ductus_identity reads through the owner policy'
);

-- 3. Who sees what through ductus_app. One line per actor: every row the
-- session can read in the eight readable tables. A version reads as
-- assignment.number, an acknowledgment as assignment.number.student.
CREATE FUNCTION pg_temp.sees(p_actor text) RETURNS text
LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, $q$
    SELECT concat_ws(' | ',
      'courses: ' || coalesce((SELECT string_agg(c.name, ' ' ORDER BY c.name) FROM institution.course c), '-'),
      'members: ' || coalesce((
        SELECT string_agg(k.name || '.' || p.name || CASE WHEN m.member_to IS NULL THEN '' ELSE '(ended)' END,
                          ' ' ORDER BY k.name, p.name)
        FROM institution.course_member m
        JOIN ref k ON k.val = m.course_id::text
        JOIN person p ON p.id = m.user_id), '-'),
      'codes: ' || (SELECT count(*) FROM institution.course_enrollment_code),
      'roles: ' || coalesce((
        SELECT string_agg(p.name || '.' || r.role, ' ' ORDER BY p.name)
        FROM institution.institution_role r JOIN person p ON p.id = r.user_id), '-'),
      'settings: ' || coalesce((SELECT string_agg(s.display_name, ' ') FROM institution.institution_settings s), '-'),
      'assignments: ' || coalesce((
        SELECT string_agg(z.name, ' ' ORDER BY z.name)
        FROM institution.assignment a JOIN ref z ON z.val = a.id::text), '-'),
      'versions: ' || coalesce((
        SELECT string_agg(z.name || '.' || v.version_no, ' ' ORDER BY z.name, v.version_no)
        FROM institution.assignment_version v JOIN ref z ON z.val = v.assignment_id::text), '-'),
      'acks: ' || coalesce((
        SELECT string_agg(z.name || '.' || n.version_no || '.' || p.name, ' ' ORDER BY z.name, n.version_no, p.name)
        FROM institution.notice_acknowledgment n
        JOIN ref z ON z.val = n.assignment_id::text
        JOIN person p ON p.id = n.student_id), '-'))
  $q$)
$f$;
-- What a session with no part in any course reads of part 2.
CREATE FUNCTION pg_temp.none() RETURNS text
LANGUAGE sql AS $$ SELECT ' | assignments: - | versions: - | acks: -' $$;

SELECT is(pg_temp.sees(v.actor), v.expected, v.actor || ': ' || v.note)
FROM (VALUES
  (1, 'vesna', 'courses: K1 | members: k1.ana k1.dora k1.vesna | codes: 2 | roles: - | settings: -'
               ' | assignments: z1 | versions: z1.1 z1.2 | acks: z1.1.ana z1.1.dora z1.2.ana',
   'teacher of K1 sees K1, all its members, its codes, its assignment with both versions and every acknowledgment'),
  (2, 'marko', 'courses: K2 | members: k2.marko | codes: 1 | roles: - | settings: -'
               ' | assignments: z2 | versions: z2.1 | acks: -',
   'teacher of another course sees nothing of K1, its assignment included'),
  (3, 'ana', 'courses: K1 | members: k1.ana k1.vesna | codes: 0 | roles: - | settings: -'
             ' | assignments: z1 | versions: z1.1 z1.2 | acks: z1.1.ana z1.2.ana',
   'student sees the course, the teacher, the own membership, the assignment and the own acknowledgments, not Dora and no code'),
  (4, 'dora', 'courses: K1 | members: k1.dora k1.vesna | codes: 0 | roles: - | settings: -'
              ' | assignments: z1 | versions: z1.1 z1.2 | acks: z1.1.dora',
   'the other student likewise sees nothing of Ana, her acknowledgments included'),
  (5, 'boris', 'courses: - | members: - | codes: 0 | roles: - | settings: -' || pg_temp.none(),
   'student of the same institution outside K1 sees nothing'),
  (6, 'nina', 'courses: - | members: - | codes: 0 | roles: - | settings: -' || pg_temp.none(),
   'unconfirmed teacher role opens nothing, not even the own role row'),
  (7, 'iva', 'courses: - | members: - | codes: 0 | roles: iva.admin marko.teacher nina.teacher vesna.teacher | settings: Fakultet A (test)'
             || pg_temp.none(),
   'administrator sees roles and settings of the own institution, no course, member, assignment or acknowledgment'),
  (8, 'lea', 'courses: - | members: - | codes: 0 | roles: lea.admin petra.teacher | settings: Fakultet B (test)'
             || pg_temp.none(),
   'administrator of another institution sees nothing of fak-a'),
  (9, 'petra', 'courses: K3 | members: k3.petra k3.tomo | codes: 1 | roles: - | settings: -'
               ' | assignments: z3 | versions: z3.1 | acks: z3.1.tomo',
   'teacher at another institution sees only K3 and what belongs to it'),
  (10, 'tomo', 'courses: K3 | members: k3.petra k3.tomo | codes: 0 | roles: - | settings: -'
               ' | assignments: z3 | versions: z3.1 | acks: z3.1.tomo',
   'student at another institution sees only K3 and what belongs to it'),
  (11, 'anon', 'courses: - | members: - | codes: 0 | roles: - | settings: -' || pg_temp.none(), 'no session sees nothing'),
  (12, 'expired', 'courses: - | members: - | codes: 0 | roles: - | settings: -' || pg_temp.none(), 'expired session of Ana sees nothing'),
  (13, 'closed', 'courses: - | members: - | codes: 0 | roles: - | settings: -' || pg_temp.none(), 'closed session of Ana sees nothing'),
  (14, 'unknown', 'courses: - | members: - | codes: 0 | roles: - | settings: -' || pg_temp.none(), 'token of no session sees nothing')
) AS v (n, actor, expected, note)
ORDER BY v.n;

-- The answer for a course one may not see is the answer for no course.
SELECT is(
  pg_temp.ask('boris', $$ SELECT count(*) FROM institution.course WHERE id = {k1} $$),
  pg_temp.ask('boris', $$ SELECT count(*) FROM institution.course WHERE id = {nobody} $$),
  'Boris: K1 by id reads the same as a course that does not exist'
);
SELECT is(
  pg_temp.ask('boris', $$ SELECT coalesce(institution.actor_course_role({k1}), 'null') $$),
  pg_temp.ask('boris', $$ SELECT coalesce(institution.actor_course_role({nobody}), 'null') $$),
  'Boris: actor_course_role is null for K1 and for a course that does not exist alike'
);
SELECT is(
  pg_temp.ask(v.actor, $$ SELECT concat_ws(' ', coalesce(institution.actor_course_role({k1}), 'null'),
                                 institution.actor_has_role('teacher')::text,
                                 institution.actor_has_role('admin')::text) $$),
  v.expected, v.actor || ': part in K1, teacher role, administrator role'
)
FROM (VALUES
  (1, 'vesna', 'teacher true false'), (2, 'ana', 'student false false'), (3, 'marko', 'null true false'),
  (4, 'iva', 'null false true'), (5, 'nina', 'null false false'), (6, 'lea', 'null false true'),
  (7, 'anon', 'null false false'), (8, 'expired', 'null false false'), (9, 'closed', 'null false false')
) AS v (n, actor, expected)
ORDER BY v.n;
-- The same for an assignment, its versions and its acknowledgments.
SELECT is(
  pg_temp.ask(v.actor, format($$ SELECT concat_ws(' ',
    (SELECT count(*) FROM institution.assignment WHERE id = %1$s),
    (SELECT count(*) FROM institution.assignment_version WHERE assignment_id = %1$s),
    (SELECT count(*) FROM institution.notice_acknowledgment WHERE assignment_id = %1$s),
    coalesce(institution.actor_assignment_role(%1$s), 'null'),
    institution.has_acknowledged_current(%1$s)::text) $$, v.assignment)),
  v.expected, format('%s: %s by id (assignment, versions, acknowledgments, part in it, current version acknowledged)', v.actor, v.assignment)
)
FROM (VALUES
  (1, 'vesna', '{z1}', '1 2 3 teacher false'), (2, 'ana', '{z1}', '1 2 2 student true'),
  (3, 'dora', '{z1}', '1 2 1 student false'), (4, 'boris', '{z1}', '0 0 0 null false'),
  (5, 'boris', '{nobody}', '0 0 0 null false'), (6, 'marko', '{z1}', '0 0 0 null false'),
  (7, 'iva', '{z1}', '0 0 0 null false'), (8, 'lea', '{z1}', '0 0 0 null false'),
  (9, 'tomo', '{z1}', '0 0 0 null false'), (10, 'ana', '{z2}', '0 0 0 null false'),
  (11, 'anon', '{z1}', '0 0 0 null false'), (12, 'expired', '{z1}', '0 0 0 null false'),
  (13, 'closed', '{z1}', '0 0 0 null false')
) AS v (n, actor, assignment, expected)
ORDER BY v.n;
SELECT is(
  pg_temp.ask('vesna', 'SELECT encode(code_hash, ''hex'') FROM institution.course_enrollment_code LIMIT 1'),
  '42501: permission denied for table course_enrollment_code',
  'Vesna: the hash of her own course''s code is not readable'
);

-- 4. Nobody raises the own role or writes a table directly (plan 10 and 13).
SELECT is(
  pg_temp.ask('ana', $$ UPDATE institution.course_member SET role = 'teacher' WHERE user_id = {ana} $$),
  '42501: permission denied for table course_member', 'Ana cannot make herself a teacher of K1'
);
SELECT is(
  pg_temp.ask('ana', $$ INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
                        VALUES ({fak_a}, {ana}, 'teacher', now()) $$),
  '42501: permission denied for table institution_role', 'Ana cannot give herself the teacher role'
);
SELECT is(
  pg_temp.ask('boris', $$ INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
                          VALUES ({k1}, {fak_a}, {boris}, 'student') $$),
  '42501: permission denied for table course_member', 'Boris cannot add himself to K1 without the code'
);
SELECT is(
  pg_temp.ask('vesna', $$ DELETE FROM institution.course_member WHERE user_id = {ana} $$),
  '42501: permission denied for table course_member', 'Vesna cannot delete a membership row; history stays'
);
SELECT is(
  pg_temp.ask(v.actor, v.statement), '42501: permission denied for table ' || v.tbl,
  v.actor || ' cannot ' || v.what
)
FROM (VALUES
  (1, 'dora', 'notice_acknowledgment', 'acknowledge by writing the row herself',
   $$ INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id) VALUES ({z1}, 2, {dora}) $$),
  (2, 'ana', 'notice_acknowledgment', 'take her acknowledgment back',
   $$ DELETE FROM institution.notice_acknowledgment WHERE student_id = {ana} $$),
  (3, 'vesna', 'notice_acknowledgment', 'acknowledge in the name of a student',
   $$ INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id) VALUES ({z1}, 2, {dora}) $$),
  (4, 'vesna', 'assignment_version', 'rewrite a version of her own assignment',
   $$ UPDATE institution.assignment_version SET title = 'Drugi naslov' WHERE assignment_id = {z1} $$),
  (5, 'vesna', 'assignment', 'move the pointer of her assignment back to the first version',
   $$ UPDATE institution.assignment SET current_version = 1 WHERE id = {z1} $$),
  (6, 'marko', 'assignment', 'put an assignment into a course of another teacher',
   $$ INSERT INTO institution.assignment (course_id, created_by) VALUES ({k1}, {marko}) $$)
) AS v (n, actor, tbl, what, statement)
ORDER BY v.n;

-- SRV-7E: the app's settings RPC reads the session institution and gives
-- each account only the settings it may see.
INSERT INTO settings.value (level, institution_id, key, value) VALUES
  ('institution', pg_temp.id('fak_a'), 'citation.style', '"apa"'),
  ('institution', pg_temp.id('fak_a'), 'lekta.profile', '"demo-profile-a"'),
  ('institution', pg_temp.id('fak_a'), 'thresholds.paste_event_chars', '250'),
  ('institution', pg_temp.id('fak_b'), 'citation.style', '"chicago"');

SELECT is(pg_temp.ask(m.actor, $$
  SELECT string_agg(concat_ws(':', CASE WHEN editor_only THEN 'editor' ELSE 'full' END, key, value), ', ' ORDER BY key)
  FROM settings.read_institution_values()
$$), m.expected, format('SRV-7E: settings scope for %s', m.actor))
FROM (VALUES
  ('iva', 'full:citation.style:"apa", full:lekta.profile:"demo-profile-a", full:thresholds.paste_event_chars:250'),
  ('ana', 'editor:citation.style:"apa", editor:lekta.profile:"demo-profile-a"'),
  ('vesna', 'editor:citation.style:"apa", editor:lekta.profile:"demo-profile-a"'),
  ('lea', 'full:citation.style:"chicago"'),
  ('tomo', 'editor:citation.style:"chicago"'),
  ('nina', 'ZD403: not allowed'),
  ('boris', 'ZD403: not allowed'),
  ('closed', 'ZD401: not authenticated'),
  ('anon', 'ZD401: not authenticated')
) AS m(actor, expected);

SELECT ok((SELECT prosecdef AND proowner = 'ductus_identity'::regrole AND provolatile = 's'
                  AND proconfig = ARRAY['search_path=""']::text[]
           FROM pg_proc WHERE oid = 'settings.read_institution_values()'::regprocedure),
          'SRV-7E: settings RPC is a confined STABLE definer');

-- 5. Removal works at once: no cached decision (plan 19).
UPDATE institution.course_member SET member_to = now() WHERE user_id = pg_temp.id('ana');
SELECT is(
  pg_temp.sees('ana'), 'courses: - | members: k1.ana(ended) | codes: 0 | roles: - | settings: -' || pg_temp.none(),
  'unenrolled student: K1, its teacher, its assignment and her acknowledgments are gone at once; only the own ended membership remains'
);
SELECT is(
  pg_temp.sees('vesna'), 'courses: K1 | members: k1.ana(ended) k1.dora k1.vesna | codes: 2 | roles: - | settings: -'
                         ' | assignments: z1 | versions: z1.1 z1.2 | acks: z1.1.ana z1.1.dora z1.2.ana',
  'the teacher still sees the ended membership and what that student acknowledged'
);
UPDATE institution.course_member SET member_to = now() WHERE user_id = pg_temp.id('vesna');
SELECT is(
  pg_temp.sees('vesna'), 'courses: - | members: k1.vesna(ended) | codes: 0 | roles: - | settings: -' || pg_temp.none(),
  'removed teacher: course, members, codes, assignment, versions and acknowledgments are gone at once'
);
SELECT is(
  pg_temp.sees('dora'), 'courses: K1 | members: k1.dora | codes: 0 | roles: - | settings: -'
                        ' | assignments: z1 | versions: z1.1 z1.2 | acks: z1.1.dora',
  'a student no longer sees the removed teacher, and keeps the assignment'
);
UPDATE institution.institution_role SET revoked_at = now() WHERE user_id = pg_temp.id('marko');
SELECT is(
  pg_temp.sees('marko'), 'courses: - | members: k2.marko | codes: 0 | roles: - | settings: -' || pg_temp.none(),
  'teacher whose role the institution revoked: an open membership alone opens nothing, the assignment of K2 included'
);
UPDATE institution.institution_role SET revoked_at = now() WHERE user_id = pg_temp.id('iva');
SELECT is(
  pg_temp.sees('iva'), 'courses: - | members: - | codes: 0 | roles: - | settings: -' || pg_temp.none(),
  'administrator whose role was revoked sees nothing'
);

SELECT is(pg_temp.ask(a.actor, 'SELECT count(*)::text FROM settings.read_institution_values()'),
          'ZD403: not allowed', format('SRV-7E: settings denied immediately after revocation for %s', a.actor))
FROM unnest(ARRAY['ana', 'marko', 'iva']) AS a(actor);

-- 6. Grants by mistake (docs/TESTING.md 5). Every role gets the schema and
-- every privilege on every table; what still holds is RLS itself. Vesna is
-- made a teacher of K1 again so that her session has rows to aim at.
UPDATE institution.course_member SET member_to = NULL WHERE user_id = pg_temp.id('vesna');
GRANT USAGE ON SCHEMA institution
  TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_evidence, ductus_migrator, ductus_test_stranger;
GRANT ALL ON ALL TABLES IN SCHEMA institution
  TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_evidence, ductus_migrator, ductus_test_stranger;

SELECT is(
  pg_temp.probe(role, 'anon', tbl, op),
  CASE op WHEN 'INSERT' THEN 'refused by RLS' ELSE 'rows=0' END,
  format('mistaken grant, %s: %s on %s', role, op, tbl)
)
FROM cell ORDER BY role_n, tbl_n, op_n;
SELECT is(
  pg_temp.probe('ductus_app', 'boris', tbl, 'SELECT'), 'rows=0',
  format('mistaken grant, Boris: SELECT on %s still returns no row', tbl)
)
FROM cell WHERE role = 'ductus_app' AND op = 'SELECT' ORDER BY tbl_n;
SELECT is(
  pg_temp.probe('ductus_app', 'vesna', tbl, op),
  CASE op WHEN 'INSERT' THEN 'refused by RLS' ELSE 'rows=0' END,
  format('mistaken grant, Vesna as teacher of K1: %s on %s changes nothing', op, tbl)
)
FROM cell WHERE role = 'ductus_app' AND op <> 'SELECT' ORDER BY tbl_n, op_n;
SELECT is(
  (SELECT concat_ws(' ', (SELECT count(*) FROM institution.institution_settings),
                         (SELECT count(*) FROM institution.institution_role),
                         (SELECT count(*) FROM institution.course),
                         (SELECT count(*) FROM institution.course_enrollment_code),
                         (SELECT count(*) FROM institution.course_member),
                         (SELECT count(*) FROM institution.assignment),
                         (SELECT count(*) FROM institution.assignment_version),
                         (SELECT count(*) FROM institution.notice_acknowledgment))),
  '2 6 3 4 6 3 4 4',
  'after every probe the fixture rows are all still there'
);

SELECT * FROM finish();
ROLLBACK;
