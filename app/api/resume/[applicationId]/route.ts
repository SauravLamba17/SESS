import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readResume } from "@/lib/recruitment/storage";
import { resolveRecruitmentScope, canAccessApplication } from "@/lib/recruitment/access";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve a candidate's resume PDF — HR/Super Admin org-wide, Manager for their
 * own department only.
 *
 * This route is the ONLY way a stored resume can be read. Files live outside
 * public/, so there is no static URL to leak or guess, and the department
 * check runs before a single byte is read from disk.
 *
 * Keyed on applicationId rather than candidateId: access is granted by the
 * ROLE this candidate applied for, which is what carries the department.
 *
 * A resume is candidate personal data: HR/Super Admin can read every one
 * org-wide, a Manager only their own department's. That scoping is enforced in
 * the handler below and is the only access control on this route.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { applicationId: string } },
) {
  const scope = await resolveRecruitmentScope();
  if (!scope.ok)
    return fail(scope.code, scope.message, scope.code === "UNAUTHENTICATED" ? 401 : 403);

  const applicationId = params.applicationId;
  if (!applicationId) return fail("BAD_INPUT", "applicationId is required", 400);

  const access = await canAccessApplication(scope, applicationId);
  if (!access.ok)
    return fail(access.code, access.message, access.code === "NOT_FOUND" ? 404 : 403);

  try {
    const app = await db.application.findUnique({
      where: { id: applicationId },
      select: {
        candidate: { select: { name: true, resumeUrl: true } },
      },
    });
    if (!app) return fail("NOT_FOUND", "Application not found", 404);

    const bytes = await readResume(app.candidate.resumeUrl);
    if (!bytes)
      return fail(
        "FILE_MISSING",
        "The stored resume file could not be found. It may have been removed from storage.",
        404,
      );

    // `inline` so HR can read it in the browser without downloading first.
    const safeName = app.candidate.name.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="resume-${safeName}.pdf"`,
        // Never cached by a shared proxy — this is personal data.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[resume] failed:", err);
    return fail("SERVER_ERROR", "Could not load the resume", 503);
  }
}
