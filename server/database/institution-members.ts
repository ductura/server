// The port of the institution RPCs of a course's students (contracts
// institution.student-removal.post, institution.student-return.post; an
// assignment's versions are institution-assignments.ts, SRV-14).
// Port of the RPC part of Ductus src/server/institution/{student-removal-route,
// student-return-route}.ts and of rpcErrorResponse in mutation-route.ts at
// 078c780, in the form of institution-courses.ts: an
// outcome (status) instead of an HTTP response, a malformed row rolls back
// and is unavailable, the port never throws and no SQLSTATE leaves it. Who
// may do what is the SECURITY DEFINER RPC's (ZD403 alike for another
// institution's course and a missing one). Inputs come already
// checked (server/institution and the route).
import { call, single, type Refused, type Unavailable } from "./institution-courses.ts";
import type { WithActor } from "./with-actor.ts";

/** ZD401, ZD403 by name; ZD422 is not judged by these RPCs, so it is unavailable (Ductus). */
export type StudentRemovalOutcome =
  | { readonly status: "removed"; readonly removed: boolean }
  | Refused<"unauthenticated" | "forbidden">
  | Unavailable;

export type StudentReturnOutcome =
  | { readonly status: "allowed"; readonly allowed: boolean }
  | Refused<"unauthenticated" | "forbidden">
  | Unavailable;

export type InstitutionMembers = {
  removeStudent(token: string, courseId: string, studentId: string): Promise<StudentRemovalOutcome>;
  allowStudentReturn(
    token: string,
    courseId: string,
    studentId: string,
  ): Promise<StudentReturnOutcome>;
};

const REMOVE_SQL = "SELECT institution.remove_student($1, $2) AS removed";
const RETURN_SQL = "SELECT institution.allow_student_return($1, $2) AS allowed";
const MEMBER_REFUSED = new Map([
  ["ZD401", "unauthenticated"],
  ["ZD403", "forbidden"],
] as const);
const readBoolean = (column: string) => (rows: unknown) => {
  const value = single(rows, column);
  return typeof value === "boolean" ? value : null;
};

export function createInstitutionMembers(withActor: WithActor): InstitutionMembers {
  return {
    async removeStudent(token, courseId, studentId) {
      const params = [courseId, studentId];
      const read = readBoolean("removed");
      const outcome = await call(
        withActor,
        token,
        REMOVE_SQL,
        params,
        read,
        MEMBER_REFUSED,
        "removal_malformed",
      );
      return "value" in outcome ? { status: "removed", removed: outcome.value } : outcome;
    },
    async allowStudentReturn(token, courseId, studentId) {
      const params = [courseId, studentId];
      const read = readBoolean("allowed");
      const outcome = await call(
        withActor,
        token,
        RETURN_SQL,
        params,
        read,
        MEMBER_REFUSED,
        "return_malformed",
      );
      return "value" in outcome ? { status: "allowed", allowed: outcome.value } : outcome;
    },
  };
}
