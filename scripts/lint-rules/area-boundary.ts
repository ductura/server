// Import boundaries between the server areas (docs/PLAN.md §3 "Pravilo
// granica", S-1A-b, DAN-769; docs/server-map.md §2). One table of allowed
// imports, AREA_IMPORTS; server/server-map.test.ts checks that it equals the
// table in docs/server-map.md §2 and has no cycle. Because only edges of that
// acyclic table pass, no cycle between areas can exist in the code (rule 5).
// A dynamic import with a computed source is reported by local/import-boundary.
import { posix } from "node:path";
import type { Rule } from "eslint";

import { isLoaderCall, type Loose, staticSpecifier } from "./database-boundary.ts";

type Node = Rule.Node;

/** docs/server-map.md §2: the areas each area may import. */
export const AREA_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  domain: [],
  contracts: [],
  settings: [],
  config: [],
  log: ["settings"],
  metrics: ["settings"],
  database: ["settings", "log", "metrics", "domain"],
  "external/srce-auth": ["settings", "log", "metrics"],
  "external/storage": ["settings", "log", "metrics", "domain"],
  "external/keys": ["settings", "log", "metrics", "domain"],
  "external/email": ["settings", "log", "metrics"],
  "external/assistant": ["domain"],
  traffic: ["settings", "log", "metrics"],
  session: ["settings", "log", "metrics", "domain", "database", "external/srce-auth"],
  roles: ["settings", "log", "metrics", "domain", "contracts", "database"],
  legal: ["settings", "log", "metrics", "domain", "contracts", "database", "external/email"],
  backup: [
    ...["settings", "log", "metrics", "domain", "contracts", "database"],
    ...["external/storage", "external/keys"],
  ],
  deletion: [
    ...["settings", "log", "metrics", "domain", "contracts", "database"],
    ...["external/storage", "external/email"],
  ],
  downloads: ["settings", "log", "metrics", "domain", "contracts", "database", "external/storage"],
  evidence: ["settings", "log", "metrics", "domain", "database", "external/storage"],
  profile: ["settings", "log", "metrics", "domain", "database"],
  institution: ["settings", "log", "metrics", "domain", "database"],
  support: ["settings", "log", "metrics", "domain", "database"],
  "source-lookup": [],
  "public-verification": ["domain", "database"],
  worker: ["log", "database", "evidence", "external/storage"],
  identity: ["domain"],
  http: [
    ...["settings", "log", "metrics", "contracts", "traffic", "session", "roles", "legal"],
    ...[
      "backup",
      "deletion",
      "downloads",
      "evidence",
      "profile",
      "institution",
      "support",
      "source-lookup",
      "public-verification",
      "database",
    ],
    ...["external/srce-auth", "external/storage", "external/keys", "external/email"],
    "external/assistant",
    "identity",
  ],
  "test-server": ["http", "settings"],
  tests: ["domain", "downloads"],
};
/** The entry point: files directly in server/ (server.ts; today index.ts and app.ts). */
export const ENTRY = "(entry)";
const ENTRY_IMPORTS: readonly string[] = ["http", "settings", "config"];
/** routes.ts imports only these areas (http only as a type) and its own ./service.ts. */
const ROUTES_IMPORTS: readonly string[] = ["contracts", "http"];
// Packages a production file of domain and contracts may import (rule 2). node:crypto
// in domain is the S-0.19 exception (server/domain/index.test.ts, CODE_PACKAGES).
const PURE_PACKAGES: Readonly<Record<string, RegExp>> = {
  domain: /^node:crypto$/u,
  contracts: /^@sinclair\/typebox(?:$|\/)/u,
};
// Code that only tests run: the golden-vector loader and the contract fake
// server (U8, kept out of production by local/no-fake-server-import).
const PURE_EXEMPT_RE =
  /^server\/(?:domain\/forensics\/golden-vectors\/load\.ts$|contracts\/generated\/fake-server\/)/u;
// Rule 4: nobody imports React, Next.js or a .tsx/.jsx module; PGlite only
// where the database lives (server/database, its tests, the PGlite fake of #35).
const UI_RE =
  /^(?:react|react-dom|next)(?:$|\/)|(?:^|\/)node_modules\/(?:\.pnpm\/)?(?:react|react-dom|next)(?:$|[/@+])|\.[jt]sx$/iu;
const PGLITE_RE =
  /^@electric-sql\/pglite(?:$|\/)|(?:^|\/)node_modules\/(?:\.pnpm\/)?@electric-sql[/+]pglite/iu;
const PGLITE_ALLOWED_RE = /^(?:server\/database|tests\/db|packages\/test-fakes\/pglite)\//u;
// Package self-reference and subpath imports would bypass the relative-path checks.
const ALIAS_RE = /^(?:#|@ductura\/institution-server(?:$|\/))/iu;
// A URL scheme other than node: (data:, file:, http:) loads code past the path checks.
const SCHEME_RE = /^(?!node:)[a-z][a-z0-9+.-]*:/iu;
// An absolute path ("/app/server/x", "C:\\x", "\\\\host") names a file past the
// relative checks, in every form: import, import(), require and createRequire.
const ABSOLUTE_RE = /^(?:[/\\]|[a-z]:[/\\])/iu;

/**
 * The login failure page (DAN-808) and receipt PDF (SRV-9C) use interface
 * text from locales/. The key is the exact repository path of the file, the
 * specifier is matched as written (no other spelling of the same path), and
 * the import must be a value import of exactly the allowed export.
 */
export const LOCALE_IMPORT_ALLOWED: Readonly<
  Record<string, { readonly specifier: string; readonly name: string }>
> = Object.freeze({
  "server/http/auth-flow.ts": Object.freeze({
    specifier: "../../locales/index.ts",
    name: "messagesHr",
  }),
  "server/http/receipt-pdf.ts": Object.freeze({
    specifier: "../../locales/index.ts",
    name: "receiptPdfHr",
  }),
  "server/http/merlin-roster/index.ts": Object.freeze({
    specifier: "../../../locales/index.ts",
    name: "merlinHr",
  }),
});

type ImportShape = {
  type: string;
  importKind?: string;
  source?: { value?: unknown };
  specifiers?: {
    type: string;
    importKind?: string;
    imported?: { type: string; name?: string; value?: unknown };
  }[];
};

/** True only for `import { messagesHr [as x] } from "<exact specifier>"` in the listed file. */
export function isAllowedLocaleImport(file: string, node: unknown): boolean {
  if (!Object.hasOwn(LOCALE_IMPORT_ALLOWED, file)) return false;
  const allowed = LOCALE_IMPORT_ALLOWED[file];
  const decl = node as ImportShape;
  if (allowed === undefined || decl.type !== "ImportDeclaration") return false;
  if (decl.importKind === "type" || decl.source?.value !== allowed.specifier) return false;
  const specifiers = decl.specifiers ?? [];
  return (
    specifiers.length === 1 &&
    specifiers.every(
      (spec) =>
        spec.type === "ImportSpecifier" &&
        spec.importKind !== "type" &&
        spec.imported?.type === "Identifier" &&
        spec.imported.name === allowed.name,
    )
  );
}

/** The area of a repository path, ENTRY for server/*.ts, undefined outside server/. */
export function areaOf(path: string): string | undefined {
  const segments = path.split("/");
  if (segments[0]?.toLowerCase() !== "server" || segments.length < 2) return undefined;
  if (segments.length === 2) return ENTRY;
  const first = segments[1]?.toLowerCase() ?? "";
  if (first !== "external") return first;
  return segments.length > 3 ? `external/${segments[2]?.toLowerCase() ?? ""}` : "external";
}

// The forms a specifier takes for the module it loads: either slash, without
// a query or fragment, %-escapes decoded, and without tab, CR and LF (URL
// parsing drops them, so "./\t../x" loads ../x); each read as text and normalized.
function spellings(specifier: string): string[] {
  return [specifier.trim(), specifier.replace(/[\t\n\r]/gu, "").trim()].flatMap((text) => {
    const cut = text.replace(/\\/g, "/").replace(/[?#].*$/su, "");
    let decoded = cut;
    try {
      decoded = decodeURIComponent(cut).replace(/[\t\n\r]/gu, "");
    } catch {
      // An invalid escape loads nothing; the other spellings are still tested.
    }
    return [...new Set([text, cut, decoded, posix.normalize(cut)])];
  });
}

export const areaBoundary: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Server areas import each other only as docs/server-map.md §2 allows" },
    schema: [],
    messages: {
      edge: "Area '{{from}}' may not import '{{to}}' (docs/server-map.md §2).",
      public: "Import area '{{to}}' only through server/{{to}}/index.ts.",
      typeOnly: "Area '{{from}}' imports '{{to}}' only with `import type` or `export type`.",
      pure: "'{{from}}' imports nothing outside itself except its allowed packages (PLAN §3, rule 2).",
      routes: "routes.ts imports only contracts, http (as a type) and its own ./service.ts.",
      ui: "Nothing imports React, Next.js or a .tsx/.jsx module (PLAN §3, rule 4).",
      pglite: "Only server/database imports PGlite (PLAN §3, rule 4).",
      alias: "Import server code by a relative path, not by a package alias.",
      outside: "Server code imports nothing outside server/ by path; use a package.",
      scheme: "Import by path or package name, not by a URL scheme.",
      absolute: "Import server code by a relative path, not an absolute one.",
    },
  },
  create(context) {
    const root = context.cwd.replace(/\\/g, "/");
    const file = posix.normalize(posix.relative(root, context.filename.replace(/\\/g, "/")));
    const dir = posix.dirname(file);
    const fromArea = areaOf(file);
    const known = fromArea === ENTRY || (fromArea !== undefined && fromArea in AREA_IMPORTS);
    const isTest = /\.test\.ts$/iu.test(file);
    const isRoutes = !isTest && posix.basename(file) === "routes.ts";
    const pure =
      !isTest && fromArea !== undefined && fromArea in PURE_PACKAGES && !PURE_EXEMPT_RE.test(file);

    function report(node: Node, messageId: string, to = ""): void {
      context.report({ node, messageId, data: { from: fromArea ?? "", to } });
    }

    // The message for an import of area `to` at `target`, or undefined when it is allowed.
    function crossProblem(target: string, to: string, typeOnly: boolean): string | undefined {
      const row = fromArea === ENTRY ? ENTRY_IMPORTS : (AREA_IMPORTS[fromArea ?? ""] ?? []);
      if (isRoutes) {
        // routes.ts narrows the area's row, never widens it: only http (as a type)
        // is added, and not in domain or contracts, which import nothing (rule 2).
        if (!ROUTES_IMPORTS.includes(to)) return "routes";
        if (to === "http" ? fromArea === undefined || fromArea in PURE_PACKAGES : !row.includes(to))
          return "edge";
        if (to === "http" && !typeOnly) return "routes";
      } else {
        if (!row.includes(to)) return "edge";
        const adapter = to === "database" || to.startsWith("external/");
        if (adapter && !typeOnly && !isTest && fromArea !== "http" && fromArea !== ENTRY)
          return "typeOnly";
      }
      return target === `server/${to}/index.ts` ? undefined : "public";
    }

    function checkRelative(node: Node, specifier: string, typeOnly: boolean): void {
      for (const text of spellings(specifier)) {
        if (!/^\.\.?(?:\/|$)/u.test(text)) continue;
        // Resolved from the absolute root, so leaving the repository and coming
        // back in ("../../../server/server/x") lands on the same file.
        const target = posix.relative(root, posix.join(root, dir, text));
        const to = target.startsWith("../") ? undefined : areaOf(target);
        if (to === fromArea) {
          if (isRoutes && target !== `${dir}/service.ts`) return report(node, "routes");
          continue;
        }
        if (to === undefined) {
          if (!isTest && isAllowedLocaleImport(file, node)) continue;
          if (pure) return report(node, "pure");
          if (isRoutes) return report(node, "routes");
          if (!isTest) return report(node, "outside");
          continue;
        }
        // Every spelling must pass: an allowed edge in one does not excuse another
        // ("../settings/\t./../index.ts" is settings as text, server/index.ts to Node).
        const problem = crossProblem(target, to, typeOnly);
        if (problem !== undefined) return report(node, problem, to);
      }
    }

    function check(node: Node, source: unknown, typeOnly: boolean): void {
      const specifier = staticSpecifier(source as Loose | undefined);
      if (specifier === undefined) return;
      const forms = spellings(specifier);
      if (forms.some((text) => UI_RE.test(text))) return report(node, "ui");
      if (forms.some((text) => PGLITE_RE.test(text)) && !PGLITE_ALLOWED_RE.test(file))
        return report(node, "pglite");
      if (!known) return;
      if (/^\.\.?(?:[/\\]|$)/u.test(specifier.trim()))
        return checkRelative(node, specifier, typeOnly);
      if (ALIAS_RE.test(specifier.trim())) return report(node, "alias");
      if (forms.some((text) => ABSOLUTE_RE.test(text))) return report(node, "absolute");
      if (forms.some((text) => SCHEME_RE.test(text))) return report(node, "scheme");
      if (pure && PURE_PACKAGES[fromArea ?? ""]?.test(specifier) !== true) report(node, "pure");
      else if (isRoutes) report(node, "routes");
    }

    type Kinded = { source?: unknown; importKind?: string; exportKind?: string };
    return {
      ImportDeclaration: (node) => check(node, node.source, (node as Kinded).importKind === "type"),
      ExportNamedDeclaration: (node) =>
        node.source && check(node, node.source, (node as Kinded).exportKind === "type"),
      ExportAllDeclaration: (node) =>
        check(node, node.source, (node as Kinded).exportKind === "type"),
      ImportExpression: (node) => check(node, node.source, false),
      CallExpression(node) {
        if (isLoaderCall(context, node.callee as Loose)) check(node, node.arguments[0], false);
      },
      TSImportType(node: Node & { source?: unknown; argument?: { literal?: unknown } }) {
        check(node, node.source ?? node.argument?.literal, true);
      },
      TSExternalModuleReference(node: Node & { expression?: unknown }) {
        const parent = (node as { parent?: Kinded }).parent;
        check(node, node.expression, parent?.importKind === "type");
      },
    };
  },
};
