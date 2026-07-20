/**
 * Manager candidate detail — same component as HR's.
 *
 * Department scoping and the hiding of offer controls both come from
 * resolveRecruitmentScope() inside the page itself, so a manager reaching a
 * candidate outside their department is refused server-side.
 */
export { default, dynamic } from "@/app/hr/candidates/[applicationId]/page";
