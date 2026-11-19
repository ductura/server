// Service of server/institution (DAN-852-3b; contract Ductus#1836
// c.6945059378): the course and enrolment code service over the database
// port (server/database/institution-courses.ts). It is the part of the
// Ductus routes create-course.ts and enrollment-code-route.ts between the
// parsed JSON and the RPC: the port gets only the output of the body
// parsers, never the raw input, and its outcome goes back unchanged. Who the
// caller is comes only from the session token; the path id and the JSON
// itself are checked by the route (852-4). The port never throws, so
// neither does this service.
import type {
  CourseCreateOutcome,
  EnrollmentCodeIssueOutcome,
  EnrollmentCodeRevokeOutcome,
  InstitutionCourses,
  InstitutionMembers,
  StudentRemovalOutcome,
  StudentReturnOutcome,
} from "../database/index.ts";

import { parseCourseBody, parseEnrollmentCodeBody } from "./schemas.ts";

/** A body the parser refused: the route's 422 invalid_input. */
export type InvalidInput = { readonly status: "invalid_input" };

export type InstitutionService = {
  createCourse(token: string, value: unknown): Promise<CourseCreateOutcome | InvalidInput>;
  issueEnrollmentCode(
    token: string,
    courseId: string,
    value: unknown,
  ): Promise<EnrollmentCodeIssueOutcome | InvalidInput>;
  revokeEnrollmentCode(token: string, courseId: string): Promise<EnrollmentCodeRevokeOutcome>;
  removeStudent(token: string, courseId: string, studentId: string): Promise<StudentRemovalOutcome>;
  allowStudentReturn(
    token: string,
    courseId: string,
    studentId: string,
  ): Promise<StudentReturnOutcome>;
};

const INVALID: InvalidInput = { status: "invalid_input" };

export function createInstitutionService(deps: {
  courses: InstitutionCourses;
  members: InstitutionMembers;
}): InstitutionService {
  return {
    async createCourse(token, value) {
      const body = parseCourseBody(value);
      return body === null ? INVALID : deps.courses.createCourse(token, body);
    },
    async issueEnrollmentCode(token, courseId, value) {
      const body = parseEnrollmentCodeBody(value);
      if (body === null) return INVALID;
      return deps.courses.issueEnrollmentCode(token, courseId, body.validUntil);
    },
    revokeEnrollmentCode: (token, courseId) => deps.courses.revokeEnrollmentCode(token, courseId),
    // The body carries nothing (the route checks it is {}); the ids come from the path.
    removeStudent: (token, courseId, studentId) =>
      deps.members.removeStudent(token, courseId, studentId),
    allowStudentReturn: (token, courseId, studentId) =>
      deps.members.allowStudentReturn(token, courseId, studentId),
  };
}
