/**
 * Version of the published API document (openapi/v1.json), major.minor.patch.
 * The major is the one in API_PREFIX and in the file name. Raise the minor for
 * an added route or field and the patch for a change of text; a change that
 * breaks existing clients is refused (scripts/check-breaking.ts) and needs a
 * new major, which is a new document and a new path prefix.
 */
export const API_VERSION = "1.32.0";

/**
 * The oldest client (preloader, web, desktop) this server still serves,
 * major.minor.patch; health sends it as minClientVersion (S-1M-a, DAN-795).
 * A client older than this asks its user to update. Raise it only together
 * with a change that old clients cannot use.
 */
export const MIN_CLIENT_VERSION = "1.0.0";
