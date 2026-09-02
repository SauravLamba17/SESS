import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardEmployee, createDefaultOnboardingTasks } from "@/lib/employees/onboard";
import { notifyHr } from "@/lib/notify";
import { checkAttestation, attestationIp } from "@/lib/attestation";
import { sendEmployeeInvitation } from "@/lib/employees/invite";
import { clerkCreateInvitation, clerkFindUserByEmail } from "@/lib/employees/invite-clerk";
import { ROLES, type Role } from "@/lib/auth-types";
import { fail } from "@/lib/api/response";
import {
  onEmployeeRosterChanged,
  onRecruitmentChanged,
} from "@/lib/invalidation/employee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Legal transitions. Anything not listed here is refused. */
const NEXT: Record<string, string[]> = {
  DRAFT: ["WITHDRAWN"],
  APPROVED: ["SENT", "WITHDRAWN"],
  SENT: ["ACCEPTED", "DECLINED", "WITHDRAWN"],
  ACCEPTED: [],
  DECLINED: [],
  WITHDRAWN: [],
};

/**
 * Advance an offer: APPROVED→SENT, SENT→ACCEPTED/DECLINED, or WITHDRAWN.
 *
 * Candidates have no accounts, so ACCEPTED/DECLINED is HR recording a
 * real-world response, not the candidate clicking anything.
 *
 * ACCEPTED additionally performs HIRE CONVERSION in the SAME transaction:
 * Employee + SalaryStructure + OnboardingTasks + application stage, all or
 * nothing. The Employee is created by the shared onboardEmployee() from
 * lib/employees/onboard.ts — the identical function Phase 5's manual HR
 * onboarding route calls — so employeeCode generation and uniqueness behave
 * the same on both paths.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may update an offer's status", 403);

  let body: {
    id?: unknown;
    status?: unknown;
    attestedName?: unknown;
    sendInvitation?: unknown;
    inviteRole?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!id || !status) return fail("BAD_INPUT", "id and status are required", 400);

  try {
    const offer = await db.offer.findUnique({
      where: { id },
      include: {
        application: {
          select: {
            id: true,
            stage: true,
            candidate: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!offer) return fail("NOT_FOUND", "Offer not found", 404);

    const allowed = NEXT[offer.status] ?? [];
    if (!allowed.includes(status))
      return fail(
        "BAD_TRANSITION",
        allowed.length === 0
          ? `This offer is ${offer.status} and is final — no further changes are possible.`
          : `Cannot go from ${offer.status} to ${status}. Allowed next: ${allowed.join(", ")}.`,
        409,
      );

    /**
     * ATTESTATION RECORD on a candidate response.
     *
     * DISTINCTION FROM THE EMPLOYEE CASE, and it matters: a candidate has no
     * account, so HR types the candidate's name while recording the response
     * they received out-of-band (email, phone, signed paper). This therefore
     * evidences HR's DATA ENTRY, not the candidate's own act — genuinely
     * weaker than the warning-letter attestation, where the employee typed
     * their own name in their own session. `attestedBy` records which HR user
     * entered it so the two are never conflated.
     *
     * Required only for ACCEPTED/DECLINED — the candidate's actual decisions.
     * SENT and WITHDRAWN are internal HR actions with no candidate response.
     */
    let attestation: { name: string; ip: string | null } | null = null;
    if (status === "ACCEPTED" || status === "DECLINED") {
      const att = checkAttestation(body.attestedName, offer.application.candidate.name);
      if (!att.ok) return fail(att.code, att.message, 400);
      attestation = { name: att.attestedName, ip: attestationIp(req.headers) };
    }

    // ── SENT / DECLINED / WITHDRAWN: a guarded status flip ──
    if (status !== "ACCEPTED") {
      const now = new Date();
      const count = await db.$transaction(async (tx) => {
        const upd = await tx.offer.updateMany({
          where: { id, status: offer.status },
          data: {
            status: status as never,
            ...(status === "SENT" ? { sentAt: now } : {}),
            ...(status === "DECLINED" || status === "WITHDRAWN" ? { respondedAt: now } : {}),
            ...(attestation
              ? {
                  attestedName: attestation.name,
                  attestedAt: now,
                  attestedIp: attestation.ip,
                  attestedBy: userId,
                }
              : {}),
          },
        });
        if (upd.count === 0) return 0;
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action:
              status === "SENT"
                ? "OFFER_SENT"
                : status === "DECLINED"
                  ? "OFFER_DECLINED"
                  : "OFFER_WITHDRAWN",
            targetEntity: id,
          },
        });

        // Candidates have no accounts, so an offer event is HR-facing news.
        // Same HR-targeting used for NEW_APPLICATION in Phase 8.
        const who = offer.application.candidate.name;
        if (status === "SENT") {
          await notifyHr(
            tx,
            "OFFER_SENT",
            `Offer sent to ${who} for ${offer.proposedDesignation}. Awaiting their response.`,
          );
        } else if (status === "DECLINED") {
          await notifyHr(
            tx,
            "OFFER_DECLINED",
            `${who} declined the offer for ${offer.proposedDesignation}.`,
          );
        }
        return upd.count;
      });
      if (count === 0)
        return fail("CONCURRENT_CHANGE", "This offer changed state. Reload and try again.", 409);
      return NextResponse.json({ ok: true, id, status });
    }

    // ── ACCEPTED: hire conversion, one atomic transaction ──
    if (offer.application.stage === "HIRED")
      return fail("ALREADY_HIRED", "This candidate has already been converted.", 409);

    const result = await db.$transaction(async (tx) => {
      // Guard first: if this fails, nothing else in the transaction happens.
      const upd = await tx.offer.updateMany({
        where: { id, status: "SENT" },
        data: {
          status: "ACCEPTED",
          respondedAt: new Date(),
          attestedName: attestation!.name,
          attestedAt: new Date(),
          attestedIp: attestation!.ip,
          attestedBy: userId,
        },
      });
      if (upd.count === 0) return { code: "CONCURRENT" as const };

      // 1. The Employee — via the SHARED Phase 5 onboarding function.
      const onboarded = await onboardEmployee(
        tx,
        {
          // No employeeCode supplied → the shared function generates the next
          // one in the same EMP-#### series HR's manual flow uses.
          name: offer.application.candidate.name,
          department: offer.proposedDepartment,
          designation: offer.proposedDesignation,
          managerId: offer.proposedManagerId,
          joiningDate: offer.joiningDate,
          // The candidate's application email — stored so the Clerk webhook
          // can correlate their eventual signup back to this Employee.
          email: offer.application.candidate.email,
        },
        userId,
      );
      if (!onboarded.ok) return { code: "ONBOARD_FAILED" as const, detail: onboarded };

      // 2. Salary structure straight from the agreed offer figures.
      await tx.salaryStructure.create({
        data: {
          employeeId: onboarded.employee.id,
          basic: offer.proposedBasic,
          hra: offer.proposedHra,
          specialAllowance: offer.proposedSpecialAllowance,
          effectiveFrom: offer.joiningDate,
          setBy: userId,
        },
      });

      // 3. Default onboarding checklist.
      const taskCount = await createDefaultOnboardingTasks(tx, onboarded.employee.id);

      // 4. The application is HIRED — set only here, never by hand.
      await tx.application.update({
        where: { id: offer.applicationId },
        data: { stage: "HIRED" },
      });

      await tx.auditLog.create({
        data: { actorUserId: userId, action: "OFFER_ACCEPTED", targetEntity: id },
      });
      await notifyHr(
        tx,
        "OFFER_ACCEPTED",
        `${offer.application.candidate.name} accepted the offer for ${offer.proposedDesignation} and has been converted to employee ${onboarded.employee.employeeCode}. Their onboarding checklist is ready.`,
      );
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "CANDIDATE_HIRED_CONVERTED",
          // All three ids, so the trail reads from any direction.
          targetEntity: `candidate=${offer.application.candidate.id} application=${offer.applicationId} employee=${onboarded.employee.id}`,
        },
      });

      return {
        code: "OK" as const,
        employee: onboarded.employee,
        taskCount,
      };
    });

    if (result.code === "CONCURRENT")
      return fail("CONCURRENT_CHANGE", "This offer changed state. Reload and try again.", 409);
    if (result.code === "ONBOARD_FAILED")
      return fail(
        result.detail.code,
        `Could not create the employee record: ${result.detail.message}`,
        result.detail.code === "DUPLICATE_CODE" || result.detail.code === "DUPLICATE_EMAIL"
          ? 409
          : 400,
      );

    // §5 "Department changed → invalidate department cache and affected team
    // views": the hire conversion just created an Employee, so it is the same
    // event as a manual onboard — department list, rosters, headcount and
    // report scopes all move. The requisition board moves too (this
    // application is now HIRED), hence both drops.
    //
    // Fired here, after the transaction committed and BEFORE the optional
    // Clerk invitation below, which deliberately cannot undo the hire and must
    // not be able to leave a stale cache behind either.
    onEmployeeRosterChanged({
      employeeId: result.employee.id,
      managerEmployeeId: offer.proposedManagerId,
    });
    onRecruitmentChanged();

    // OPT-IN login invitation, AFTER the conversion committed — same shared
    // logic as manual onboarding; a Clerk failure never undoes the hire.
    let invitation: { sent: boolean; linked: boolean; message?: string; error?: string } | null = null;
    if (body.sendInvitation === true) {
      const inviteRole = (ROLES as string[]).includes(String(body.inviteRole))
        ? (body.inviteRole as Role)
        : "EMPLOYEE";
      const inv = await sendEmployeeInvitation(
        db,
        {
          employeeId: result.employee.id,
          email: offer.application.candidate.email,
          role: inviteRole,
          actorUserId: userId,
        },
        clerkCreateInvitation,
        clerkFindUserByEmail,
      );
      invitation = inv.ok
        ? { sent: !inv.linked, linked: inv.linked, message: inv.message }
        : { sent: false, linked: false, error: inv.message };
    }

    return NextResponse.json({
      ok: true,
      id,
      status: "ACCEPTED",
      employeeId: result.employee.id,
      employeeCode: result.employee.employeeCode,
      onboardingTasksCreated: result.taskCount,
      invitation,
    });
  } catch (err) {
    console.error("[hr/offer/status] failed:", err);
    return fail("SERVER_ERROR", "Could not update the offer", 503);
  }
}
