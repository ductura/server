import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isBlocking, lockfilePackages, scan, severityOf } from "./osv-scan.ts";

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      a:
        specifier: 1.0.0
        version: 1.0.0

packages:

  '@scope/b@2.1.0':
    resolution: {integrity: sha512-x}

  a@1.0.0:
    resolution: {integrity: sha512-y}
    engines: {node: '>=14'}

  c@3.0.0-rc.1:
    resolution: {integrity: sha512-z}

snapshots:

  a@1.0.0: {}
`;

describe("lockfilePackages", () => {
  it("reads scoped, plain and pre-release keys, and stops at snapshots", () => {
    assert.deepEqual(lockfilePackages(LOCK), [
      { name: "@scope/b", version: "2.1.0" },
      { name: "a", version: "1.0.0" },
      { name: "c", version: "3.0.0-rc.1" },
    ]);
  });

  it("refuses a lockfile it cannot read instead of passing it", () => {
    assert.throws(() => lockfilePackages("lockfileVersion: '9.0'\n"));
    assert.throws(() => lockfilePackages("packages:\n\nsnapshots:\n"));
  });

  it("lists exactly the packages of this spike's own lockfile", () => {
    const names = lockfilePackages(
      readFileSync(new URL("./pnpm-lock.yaml", import.meta.url), "utf8"),
    ).map((p) => p.name);
    assert.ok(names.includes("fflate") && names.includes("fast-xml-parser"));
  });
});

describe("severity", () => {
  it("blocks HIGH, CRITICAL and anything it cannot read", () => {
    for (const label of ["HIGH", "CRITICAL", "UNKNOWN", "SOMETHING"])
      assert.equal(isBlocking(label), true);
    for (const label of ["LOW", "MODERATE", "MEDIUM"]) assert.equal(isBlocking(label), false);
    assert.equal(severityOf({ ["database_specific"]: { severity: "High" } }), "HIGH");
    assert.equal(severityOf({}), "UNKNOWN");
    assert.equal(severityOf(null), "UNKNOWN");
  });
});

describe("scan", () => {
  const packages = [
    { name: "a", version: "1.0.0" },
    { name: "b", version: "2.0.0" },
  ];
  const answer = (batch: unknown, records: Record<string, unknown> = {}): typeof fetch =>
    (async (url: string | URL | Request) => {
      const text = String(url);
      const id = text.split("/vulns/")[1];
      const body = id === undefined ? batch : records[decodeURIComponent(id)];
      return {
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
        json: async () => body,
      };
    }) as unknown as typeof fetch;

  it("maps findings to packages and reads their severity", async () => {
    const findings = await scan(
      packages,
      answer(
        { results: [{}, { vulns: [{ id: "GHSA-1" }] }] },
        { "GHSA-1": { ["database_specific"]: { severity: "HIGH" } } },
      ),
    );
    assert.deepEqual(findings, [{ id: "GHSA-1", pkg: packages[1], severity: "HIGH" }]);
  });

  it("is clean when OSV reports nothing", async () => {
    assert.deepEqual(await scan(packages, answer({ results: [{}, {}] })), []);
  });

  it("fails when OSV answers for fewer packages or with an error", async () => {
    await assert.rejects(scan(packages, answer({ results: [{}] })));
    await assert.rejects(scan(packages, answer({ results: [{ vulns: [{ id: "X" }] }, {}] })));
  });
});
