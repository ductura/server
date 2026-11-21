// SRV-1802 (M8.8): OSV scan of this spike's own lockfile. Reads pnpm-lock.yaml,
// asks api.osv.dev for known vulnerabilities of every pinned package and exits
// 1 on any HIGH or CRITICAL finding, or on a finding whose severity it cannot
// read (fail closed). No dependency and no third-party action: the CI job only
// needs Node. Only package names and versions leave the machine.
import { readFileSync } from "node:fs";

export type Pkg = { name: string; version: string };
export type Finding = { id: string; pkg: Pkg; severity: string };
type Fetch = typeof fetch;

const OSV = "https://api.osv.dev/v1";
const BLOCKING = new Set(["HIGH", "CRITICAL"]);

/** Packages of a pnpm lockfile v9: the keys of the `packages:` section. */
export function lockfilePackages(lockfile: string): Pkg[] {
  const start = lockfile.search(/^packages:\s*$/m);
  if (start < 0) throw new Error("lockfile has no packages: section");
  const out = new Map<string, Pkg>();
  const section = lockfile.slice(start).split("\n").slice(1);
  for (const line of section) {
    if (/^\S/.test(line)) break; // next top-level section (snapshots:)
    const match = /^ {2}'?((?:@[^/@\s]+\/)?[^@\s']+)@([^':\s(]+)'?:\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      out.set(`${match[1]}@${match[2]}`, { name: match[1], version: match[2] });
    }
  }
  if (out.size === 0) throw new Error("lockfile lists no packages");
  return [...out.values()];
}

/** Severity label of an OSV record; unknown when it cannot be read. */
export function severityOf(record: unknown): string {
  // OSV's own snake_case field, read through a string key.
  const specific = (record as Record<string, { severity?: unknown } | undefined> | null)?.[
    "database_specific"
  ];
  const label = specific?.severity;
  return typeof label === "string" && label !== "" ? label.toUpperCase() : "UNKNOWN";
}

export function isBlocking(severity: string): boolean {
  return BLOCKING.has(severity) || !["LOW", "MODERATE", "MEDIUM"].includes(severity);
}

async function json(fetcher: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function scan(packages: Pkg[], fetcher: Fetch = fetch): Promise<Finding[]> {
  const queries = packages.map((pkg) => ({
    package: { name: pkg.name, ecosystem: "npm" },
    version: pkg.version,
  }));
  const batch = (await json(fetcher, `${OSV}/querybatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries }),
  })) as { results?: { vulns?: { id: string }[] }[] };
  const results = batch.results ?? [];
  // A short answer would silently skip packages, so it is an error.
  if (results.length !== packages.length) throw new Error("OSV answered for fewer packages");
  const findings: Finding[] = [];
  for (const [index, result] of results.entries()) {
    const pkg = packages[index];
    if (pkg === undefined) continue;
    for (const { id } of result.vulns ?? []) {
      const record = await json(fetcher, `${OSV}/vulns/${encodeURIComponent(id)}`);
      findings.push({ id, pkg, severity: severityOf(record) });
    }
  }
  return findings;
}

async function main(): Promise<void> {
  const path = process.argv[2] ?? "pnpm-lock.yaml";
  const packages = lockfilePackages(readFileSync(path, "utf8"));
  const findings = await scan(packages);
  console.log(`OSV: ${packages.length} packages in ${path}, ${findings.length} findings`);
  for (const f of findings) {
    console.log(`  ${f.id} ${f.pkg.name}@${f.pkg.version} ${f.severity}`);
  }
  const blocking = findings.filter((f) => isBlocking(f.severity));
  if (blocking.length > 0) {
    console.error(`OSV: ${blocking.length} HIGH, CRITICAL or unreadable-severity findings`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
