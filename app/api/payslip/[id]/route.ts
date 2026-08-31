import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { renderPayslip } from "@/lib/payroll/pdf";
import { periodLabel } from "@/lib/payroll/format";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RED TIER — never cache, see SESS_Caching_Strategy.docx Section 3.
 *
 * Payslip financial values, plus the role scoping that decides WHOSE payslip
 * the caller may pull. Both are resolved against the database on every
 * request. Section 8 additionally forbids CDN-caching an authenticated
 * response like this one; force-dynamic above keeps it out of every shared
 * layer.
 */

/**
 * Download one payslip as a PDF.
 *
 * FINALIZED rows only — for EVERYONE, HR included. A DRAFT or SUBMITTED figure
 * is provisional; rendering it as "your payslip" would put a number in an
 * employee's hands that the Super Admin has not approved and may still change.
 *
 * This serves salary figures, and HR/Super Admin can pull ANY employee's while
 * an employee may pull only their own. That scoping is enforced in the handler
 * below and is the only access control on this route.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  const id = params.id;
  if (!id) return fail("BAD_INPUT", "Payroll id is required", 400);

  try {
    const role = await getCurrentRole();
    const isPrivileged = role === "HR" || role === "SUPER_ADMIN";

    const row = await db.payroll.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            employeeCode: true,
            department: true,
            designation: true,
            pfUan: true,
          },
        },
        // Joined, not a second round-trip — a correction's slip must name the
        // payslip it corrects.
        adjustmentFor: { select: { month: true, finalizedAt: true } },
      },
    });
    if (!row) return fail("NOT_FOUND", "Payslip not found", 404);

    // Scope: an employee may only ever fetch their OWN payslip.
    if (!isPrivileged) {
      const me = await getEmployeeByClerkId(userId);
      if (!me || me.id !== row.employeeId)
        return fail("FORBIDDEN", "You may only download your own payslip", 403);
    }

    if (row.status !== "FINALIZED")
      return fail(
        "NOT_FINALIZED",
        "This payslip is not finalized yet. Payslips become available once a Super Admin finalizes the payroll run.",
        409,
      );

    const pdf = await renderPayslip({
      employeeName: row.employee.name,
      employeeCode: row.employee.employeeCode,
      department: row.employee.department,
      designation: row.employee.designation,
      pfUan: row.employee.pfUan,
      period: row.month,
      daysWorked: row.daysWorked,
      daysInMonth: row.daysInMonth,
      isFinalSettlement: row.isFinalSettlement,
      adjustmentFor: row.adjustmentFor
        ? {
            period: periodLabel(row.adjustmentFor.month),
            finalizedAt: row.adjustmentFor.finalizedAt,
          }
        : null,
      loanDeduction: row.loanDeduction.toFixed(2),
      basic: row.basic.toFixed(2),
      hra: row.hra.toFixed(2),
      specialAllowance: row.specialAllowance.toFixed(2),
      bonus: row.bonus.toFixed(2),
      reimbursements: row.reimbursements.toFixed(2),
      pfEmployee: row.pfEmployee.toFixed(2),
      pfEmployer: row.pfEmployer.toFixed(2),
      esi: row.esi.toFixed(2),
      professionalTax: row.professionalTax.toFixed(2),
      tds: row.tds.toFixed(2),
      tdsSource: row.tdsSource,
      gross: row.gross.toFixed(2),
      deductions: row.deductions.toFixed(2),
      net: row.net.toFixed(2),
      finalizedAt: row.finalizedAt,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        // Distinct filename so a correction never overwrites the original in
        // the employee's downloads folder.
        "Content-Disposition": `attachment; filename="payslip-${row.employee.employeeCode}-${row.month}${
          row.adjustmentFor ? `-adjustment-${row.id.slice(-6)}` : ""
        }.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[payslip] failed:", err);
    return fail("SERVER_ERROR", "Could not generate the payslip", 503);
  }
}
