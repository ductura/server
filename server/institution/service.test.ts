// DAN-852-3b (contract Ductus#1836 c.6945059378): the institution service
// calls the port only with what the body parsers accepted, never with the
// raw input; a refused body is invalid_input without any call, and the
// port's outcome is passed on unchanged. Every token and value is invented.
import { describe, expect, it } from "vitest";

import type { InstitutionCourses, InstitutionMembers } from "../database/index.ts";

import { createInstitutionService } from "./service.ts";

const TOKEN = "izmisljeni-token-ustanove-0000000000000001";
const COURSE = "7b6a5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c01";
const BODY = { name: "Izmišljeni kolegij B", academicYear: "2026/2027", aiPolicy: "prohibited" };
const UNTIL = "2026-12-31T23:59:59.123456+01:00";
const INVALID = { status: "invalid_input" };

function fake(answer: unknown = { status: "unavailable", reason: "database_error" }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return answer;
    };
  const courses = {
    createCourse: record("createCourse"),
    issueEnrollmentCode: record("issueEnrollmentCode"),
    revokeEnrollmentCode: record("revokeEnrollmentCode"),
  } as unknown as InstitutionCourses;
  const members = {
    removeStudent: record("removeStudent"),
    allowStudentReturn: record("allowStudentReturn"),
  } as unknown as InstitutionMembers;
  return { service: createInstitutionService({ courses, members }), calls };
}

describe("createCourse refuses a body before the port", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["an institution id too", { ...BODY, institutionId: COURSE }],
    ["inherited keys", Object.create(BODY) as unknown],
    ["a name with a trailing space", { ...BODY, name: `${BODY.name} ` }],
    ["years two apart", { ...BODY, academicYear: "2026/2028" }],
    ["a policy outside the set", { ...BODY, aiPolicy: "allowed" }],
  ])("%s is invalid_input and calls nothing", async (_, value) => {
    const { service, calls } = fake();
    expect(await service.createCourse(TOKEN, value)).toEqual(INVALID);
    expect(calls).toHaveLength(0);
  });
});

describe("issueEnrollmentCode refuses a body before the port", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["an empty object", {}],
    ["a course id too", { validUntil: UNTIL, courseId: COURSE }],
    ["February 30", { validUntil: "2026-02-30T12:00:00Z" }],
    ["a trailing LF", { validUntil: `${UNTIL}\n` }],
  ])("%s is invalid_input and calls nothing", async (_, value) => {
    const { service, calls } = fake();
    expect(await service.issueEnrollmentCode(TOKEN, COURSE, value)).toEqual(INVALID);
    expect(calls).toHaveLength(0);
  });
});

describe("the service calls the port once with the parser's output", () => {
  it("createCourse passes a new object of the three accepted values", async () => {
    const { service, calls } = fake();
    const input = { ...BODY };
    await service.createCourse(TOKEN, input);
    expect(calls).toEqual([{ method: "createCourse", args: [TOKEN, BODY] }]);
    expect(calls[0]?.args[1]).not.toBe(input);
  });

  it("issueEnrollmentCode passes the course id and the instant as sent", async () => {
    const { service, calls } = fake();
    await service.issueEnrollmentCode(TOKEN, COURSE, { validUntil: UNTIL });
    expect(calls).toEqual([{ method: "issueEnrollmentCode", args: [TOKEN, COURSE, UNTIL] }]);
  });

  it("revokeEnrollmentCode passes the token and the course id", async () => {
    const { service, calls } = fake();
    await service.revokeEnrollmentCode(TOKEN, COURSE);
    expect(calls).toEqual([{ method: "revokeEnrollmentCode", args: [TOKEN, COURSE] }]);
  });
});

describe("the service passes the port's outcome on unchanged", () => {
  it.each([
    { status: "created", id: COURSE },
    { status: "issued", code: "A1B2-C3D4-E5F6-0789" },
    { status: "revoked", revoked: false },
    { status: "unauthenticated" },
    { status: "forbidden" },
    { status: "conflict" },
    { status: "invalid" },
    { status: "unavailable", reason: "database_error" },
    { status: "unavailable", reason: "issue_malformed" },
  ])("%o", async (outcome) => {
    const { service } = fake(outcome);
    expect(await service.createCourse(TOKEN, { ...BODY })).toBe(outcome);
    expect(await service.issueEnrollmentCode(TOKEN, COURSE, { validUntil: UNTIL })).toBe(outcome);
    expect(await service.revokeEnrollmentCode(TOKEN, COURSE)).toBe(outcome);
  });
});

const STUDENT = "9d8c7b6a-5f4e-4c3b-9a2d-1e0f9a8b7c01";

describe("the student operations", () => {
  it("removal and return pass the path ids to the port and its outcome back unchanged", async () => {
    const outcome = { status: "removed", removed: true };
    const { service, calls } = fake(outcome);
    expect(await service.removeStudent(TOKEN, COURSE, STUDENT)).toBe(outcome);
    expect(await service.allowStudentReturn(TOKEN, COURSE, STUDENT)).toBe(outcome);
    expect(calls).toEqual([
      { method: "removeStudent", args: [TOKEN, COURSE, STUDENT] },
      { method: "allowStudentReturn", args: [TOKEN, COURSE, STUDENT] },
    ]);
  });
});
