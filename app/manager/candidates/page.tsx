/**
 * Manager view of the recruitment pipeline.
 *
 * Reuses the HR page component wholesale: that page already resolves scope via
 * resolveRecruitmentScope(), which narrows a MANAGER to their own department
 * and hides the pipeline-move controls. Duplicating it here would mean two
 * places to keep the department rule correct.
 */
export { default, dynamic } from "@/app/hr/candidates/page";
