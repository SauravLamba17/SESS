import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { renderOfferLetter } from "@/lib/payroll/pdf";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Statuses whose figures a Super Admin has authorised, so the letter is real. */
const DOWNLOADABLE = ["APPROVED", "SENT", "ACCEPTED", "DECLINED"];

/**
 * Download the offer letter as a PDF.
 *
 * A DRAFT offer is explicitly refused. Its figures have not been approved by a
 * Super Admin and can still change, so producing a signed-looking letter from
 * them would put an unauthorised number in a candidate's hands — the same
 * reasoning that stops an unfinalized payslip being downloadable in Phase 7.
 *
 * WITHDRAWN is also refused: there is no offer to letter-ise any more.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may download an offer letter", 403);

  const id = params.id;
  if (!id) return fail("BAD_INPUT", "Offer id is required", 400);

  try {
    const offer = await db.offer.findUnique({
      where: { id },
      include: {
        application: {
          select: { candidate: { select: { name: true } } },
        },
      },
    });
    if (!offer) return fail("NOT_FOUND", "Offer not found", 404);

    if (!DOWNLOADABLE.includes(offer.status))
      return fail(
        "NOT_APPROVED",
        offer.status === "DRAFT"
          ? "This offer is still a DRAFT and has not been approved by a Super Admin. Its figures could still change, so no letter can be issued yet."
          : `An offer letter cannot be issued for a ${offer.status} offer.`,
        409,
      );

    // Reporting manager resolved by name for the letter — one extra lookup
    // only when the offer actually names one.
    const manager = offer.proposedManagerId
      ? await db.employee.findUnique({
          where: { id: offer.proposedManagerId },
          select: { name: true, designation: true },
        })
      : null;

    // Decimal arithmetic all the way to the formatter — no Number casts.
    const gross = offer.proposedBasic
      .plus(offer.proposedHra)
      .plus(offer.proposedSpecialAllowance);
    const annual = gross.times(new Prisma.Decimal(12));

    const pdf = await renderOfferLetter({
      candidateName: offer.application.candidate.name,
      designation: offer.proposedDesignation,
      department: offer.proposedDepartment,
      joiningDate: offer.joiningDate,
      basic: offer.proposedBasic.toFixed(2),
      hra: offer.proposedHra.toFixed(2),
      specialAllowance: offer.proposedSpecialAllowance.toFixed(2),
      gross: gross.toFixed(2),
      annualGross: annual.toFixed(2),
      reportingTo: manager
        ? `${manager.name}${manager.designation ? `, ${manager.designation}` : ""}`
        : null,
      status: offer.status,
      approvedAt: offer.approvedAt,
      generatedAt: new Date(),
    });

    const safeName = offer.application.candidate.name
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .slice(0, 40);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="offer-letter-${safeName}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[hr/offer/letter] failed:", err);
    return fail("SERVER_ERROR", "Could not generate the offer letter", 503);
  }
}
