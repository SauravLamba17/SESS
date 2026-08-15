import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { ymd } from "@/lib/reports/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401 },
    );
  }

  const now = new Date();
  const yearParam = Number(req.nextUrl.searchParams.get("year"));
  const monthParam = Number(req.nextUrl.searchParams.get("month")); // 1-12
  const year = Number.isInteger(yearParam) ? yearParam : now.getFullYear();
  const month =
    Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12
      ? monthParam
      : now.getMonth() + 1;

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1); // exclusive

  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) {
      return NextResponse.json(
        { ok: false, error: "No employee record linked to this account." },
        { status: 409 },
      );
    }

    // Own records only.
    const rows = await db.attendance.findMany({
      where: {
        employeeId: employee.id,
        date: { gte: monthStart, lt: monthEnd },
      },
      orderBy: { date: "asc" },
    });

    const days = rows.map((r) => ({
      date: ymd(r.date),
      checkIn: r.checkIn ? r.checkIn.toISOString() : null,
      checkOut: r.checkOut ? r.checkOut.toISOString() : null,
      lateFlag: r.lateFlag,
      lateMinutes: r.lateMinutes, // null for historical rows / not late
      flaggedForReview: r.flaggedForReview,
    }));

    return NextResponse.json({
      ok: true,
      year,
      month,
      joiningDate: employee.joiningDate.toISOString(),
      days,
    });
  } catch (err) {
    console.error("[attendance/month] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Attendance data is unavailable right now.",
      },
      { status: 503 },
    );
  }
}
