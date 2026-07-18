import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return fail("BAD_INPUT", "id is required", 400);

  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    // Owner + RELEASED enforced in the where-clause: a letter that isn't this
    // employee's, or isn't released yet, matches zero rows.
    const upd = await db.warningLetter.updateMany({
      where: { id, employeeId: employee.id, status: "RELEASED" },
      data: { acknowledged: true },
    });
    if (upd.count === 0)
      return fail("NOT_ACKNOWLEDGEABLE", "Letter not found, not yours, or not yet released", 409);

    return NextResponse.json({ ok: true, id, acknowledged: true });
  } catch (err) {
    console.error("[employee/warning/acknowledge] failed:", err);
    return fail("SERVER_ERROR", "Could not acknowledge the letter", 503);
  }
}
