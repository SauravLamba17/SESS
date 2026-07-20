import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  // HR-only release authority — enforced here, not just hidden in the UI.
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may release warning letters", 403);

  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return fail("BAD_INPUT", "id is required", 400);

  try {
    // Atomic DRAFT→RELEASED: the where-clause enforces the current state, so a
    // double-release matches zero rows. Audit only on a real transition.
    const count = await db.$transaction(async (tx) => {
      const upd = await tx.warningLetter.updateMany({
        where: { id, status: "DRAFT" },
        data: { status: "RELEASED", releasedBy: userId, releasedAt: new Date() },
      });
      if (upd.count === 0) return 0;
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "WARNING_LETTER_RELEASED", targetEntity: id },
      });
      return upd.count;
    });

    if (count === 0)
      return fail("NOT_DRAFT", "Letter not found or already released", 409);

    return NextResponse.json({ ok: true, id, status: "RELEASED" });
  } catch (err) {
    console.error("[hr/warning/release] failed:", err);
    return fail("SERVER_ERROR", "Could not release the letter", 503);
  }
}
