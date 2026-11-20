-- SRV-9B (Ductus#2028, c.7041664094; plan „Val 9”, ✓ C-6): the public check of
-- a submission receipt, behind POST /api/v1/public/verification. The QR of the
-- receipt carries the submission id and the SHA-256 of the submitted text
-- (server/downloads/receipt-pdf, fragment r= and o=). Anyone who holds both may
-- learn whether a signed receipt binds exactly that text; nobody learns
-- anything from one of them alone.
--
-- The function runs without a session and never reads one: it is not a way to
-- sign in (D-09) and gives no access to a work (C-23). It answers "match" only
-- when a bound receipt exists for the submission and the submission's artifact
-- hash equals the one asked for; then it returns the signed receipt and its
-- one key, so the web process checks the Ed25519 signature itself (the database
-- cannot), and the web process answers the public only whether it matches, when
-- the text was submitted and signed, and the key id. Every other case (no such
-- submission, no bound receipt yet, another hash, a malformed argument) is the
-- same "no_match" with nothing else, so the answer never tells an existing
-- submission from an unknown one. No name, course, assignment or text leaves
-- the web process.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

CREATE FUNCTION app.public_receipt_verification(p_submission_id uuid, p_artifact_sha256 text)
RETURNS TABLE (
  outcome text, receipt_payload text, payload_digest_sha256 text, signature jsonb,
  key_base64url text, key_evidence_domain_id uuid, key_purpose text,
  key_valid_from timestamptz, key_valid_to timestamptz, key_revoked_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_submission_id IS NOT NULL AND p_artifact_sha256 IS NOT NULL AND p_artifact_sha256 ~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY
      SELECT 'match'::text, r.receipt_payload, r.payload_digest_sha256, r.signature,
             k.key_base64url, k.evidence_domain_id, k.purpose, k.valid_from, k.valid_to, k.revoked_at
        FROM evidence.submission_receipt r
        JOIN evidence.submission s ON s.id = r.submission_id AND s.institution_id = r.institution_id
        JOIN evidence.signing_key k ON k.key_id = r.key_id AND k.key_version = r.key_version
       WHERE r.submission_id = p_submission_id AND s.artifact_hash = p_artifact_sha256;
    IF FOUND THEN RETURN; END IF;
  END IF;
  RETURN QUERY SELECT 'no_match'::text, NULL::text, NULL::text, NULL::jsonb, NULL::text, NULL::uuid,
    NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz;
END
$$;
REVOKE ALL ON FUNCTION app.public_receipt_verification(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_receipt_verification(uuid, text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
-- Local only; staging and production only go forward (docs/BACKEND.md §6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.public_receipt_verification(uuid, text);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;
