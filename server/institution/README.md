# server/institution

Područje iz [karte servera](../../docs/server-map.md) (DAN-852-1, S-M-2a). Prenosi Ductus `src/server/institution` za kolegije ustanove: kreiranje kolegija, kôd upisa i njegov opoziv. Nema `routes.ts`: rute su u `server/http`, kao kod `profile`.

## Što radi

Feature područje. Danas ima provjeru tijela kolegija `parseCourseBody` (`schemas.ts`), doslovni prijenos Ductus `courseInput` iz `create-course.ts`: objekt s točno vlastitim ključevima `name`, `academicYear` i `aiPolicy`; ime od 1 do 160 UTF-16 jedinica bez razmaka (JS `trim`) na rubovima; godina `YYYY/YYYY` u kojoj je druga za jedan veća od prve; politika `prohibited`, `partially_allowed` ili `encouraged`. Sve drugo daje `null`, što ruta pretvara u 422. Ime dalje sudi RPC (`institution.is_plain_label`). Uz nju je provjera tijela koda upisa `parseEnrollmentCodeBody` (DAN-852-3a), doslovni prijenos provjere tijela i `validTimestamp` iz Ductus `enrollment-code-route.ts`: objekt s točno jednim vlastitim ključem `validUntil` čija je vrijednost trenutak `YYYY-MM-DDTHH:MM:SS[.f{1,6}](Z|±HH:MM)` sa stvarnim datumom i vremenom (prijestupne godine, pomak do 15:59); vrijednost se vraća nepromijenjena, sve drugo je `null` (422). Je li trenutak u budućnosti sudi RPC. Uz njih je provjera tijela upisa `parseEnrollmentBody` (DAN-853-1c), doslovni prijenos `validInput` iz Ductus `enrollment-route.ts`: objekt (ne niz) kojem `Object.keys` daje točno jedan ključ i koji ima vlastiti `code`, string od najviše 64 UTF-16 jedinice. Za JSON tijelo to znači točno `{ code }`; nenabrojivi ili simbolni ključevi, koje JSON ne stvara, ne broje se, kao u Ductusu. Vrijednost se vraća nepromijenjena, jer razmake, crtice i veličinu slova zanemaruje RPC (`institution.enroll_with_code`). Sve drugo je `null` (422), a getter ili Proxy koji baca također daje `null`, gdje je Ductus bacao. Provjera tijela nove verzije zadatka je `parseAssignmentVersionBody` u `assignment-input.ts` (SRV-14). Servis `createInstitutionService({ courses, members })` (DAN-852-3b, `service.ts`) poziva port baze `InstitutionCourses` samo s izlazom tih provjera, nikad sa sirovim ulazom: odbijeno tijelo daje `invalid_input` bez poziva porta, a ishod porta vraća se nepromijenjen. Servis sastavlja `server/http` (`institution-courses.ts`, 852-4), a rute nad glavnom bazom montira `server/server.ts` (852-5a).

## Tko ga zove

Samo `http`.

## Koje podatke dira

Servis čita i piše kolegije i kodove upisa u glavnoj bazi samo kroz port `server/database/institution-courses.ts`, odnosno RPC `institution.create_course()`, `institution.create_enrollment_code()` i `institution.revoke_enrollment_code()`, a studente kolegija kroz `server/database/institution-members.ts` (`institution.remove_student()`, `institution.allow_student_return()`). Pozivatelj, ustanova i članstvo dolaze iz sesije, nikad iz tijela.

## Što izvozi

- `parseCourseBody(value)` i tipove `CourseBody` i `AiPolicy` (`schemas.ts`); funkcija nikad ne baca i vraća novi objekt s točno tri ključa;
- `parseEnrollmentCodeBody(value)` i tip `EnrollmentCodeBody` (`schemas.ts`); nikad ne baca i vraća novi objekt s točno ključem `validUntil`;
- `parseEnrollmentBody(value)` i tip `EnrollmentBody` (`schemas.ts`); nikad ne baca i vraća novi objekt s točno ključem `code`;
- `createInstitutionService({ courses, members })` i tipove `InstitutionService` i `InvalidInput` (`service.ts`): `createCourse(token, value)`, `issueEnrollmentCode(token, courseId, value)` `revokeEnrollmentCode(token, courseId)`, `removeStudent(token, courseId, studentId)`, `allowStudentReturn(token, courseId, studentId)` (port `InstitutionMembers`, ishod nepromijenjen); servis nikad ne baca;

## Što ne smije uvoziti

Smije uvoziti samo `settings`, `log`, `metrics`, `domain` i `database`, i to kroz njihov `index.ts`. `database` uvozi samo s `import type` (tip porta); adapter mu predaje `http`. Ne uvozi `http`, `contracts`, `session` ni `test-server`. S drugim feature područjima dijeli podatke samo kroz bazu i RPC. Popis je u [karti servera, §2](../../docs/server-map.md#2-dopušteni-uvozi); provjera je lint `local/area-boundary`.
