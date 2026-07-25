import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";
import { getActiveEmployees } from "@/lib/data/scope";
import { resolvePeriodRange } from "@/lib/appraisal/period-range";
import {
  computeAppraisal,
  type AppraisalWeights,
  type EmployeeMetrics,
} from "@/lib/appraisal/compute";
import { withPrivilegedRoute } from "@/lib/mfa-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function parseWeights(raw: unknown): AppraisalWeights {
  const w = (raw ?? {}) as Record<string, unknown>;
  return {
    punctuality: Number(w.punctuality) || 0,
    production: Number(w.production) || 0,
    quality: Number(w.quality) || 0,
    feedback: Number(w.feedback) || 0,
    warningPenaltyPoints: Number(w.warningPenaltyPoints) || 0,
    // NaN when a (pre-Phase-8) snapshot lacks these — compute.ts defaults them.
    punctualityFrequencyWeight: Number(w.punctualityFrequencyWeight),
    punctualitySeverityWeight: Number(w.punctualitySeverityWeight),
    punctualitySeverityCapMinutes: Number(w.punctualitySeverityCapMinutes),
  };
}

async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may compute scores", 403);

  let body: { cycleId?: unknown; allowMissingFeedback?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const cycleId = typeof body.cycleId === "string" ? body.cycleId : "";
  const allowMissingFeedback = body.allowMissingFeedback === true;
  if (!cycleId) return fail("BAD_INPUT", "cycleId is required", 400);

  try {
    const cycle = await db.appraisalCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) return fail("NOT_FOUND", "Cycle not found", 404);
    if (cycle.published)
      return fail("PUBLISHED", "Cycle is published; scores are immutable", 409);

    const range = resolvePeriodRange(cycle.period);
    if (!range)
      return fail(
        "BAD_PERIOD",
        `Cannot compute: cycle period "${cycle.period}" must be YYYY-MM or YYYY-Qn`,
        400,
      );

    const weights = parseWeights(cycle.weightsJson);
    const employees = await getActiveEmployees(cycle.department);
    const ids = employees.map((e) => e.id);
    const inRange = { gte: range.start, lt: range.end };

    if (ids.length === 0)
      return NextResponse.json({ ok: true, cycleId, total: 0, complete: 0, incomplete: [] });

    // ── Batch fetch: a fixed handful of queries, independent of headcount ──
    const [attTotal, attLate, prodSum, targets, qualAvg, warnings, existing] =
      await Promise.all([
        db.attendance.groupBy({
          by: ["employeeId"],
          where: { employeeId: { in: ids }, date: inRange },
          _count: { _all: true },
        }),
        db.attendance.groupBy({
          by: ["employeeId"],
          where: { employeeId: { in: ids }, date: inRange, lateFlag: true },
          _count: { _all: true },
          _sum: { lateMinutes: true }, // Phase 8: for severity (late days only)
        }),
        db.production.groupBy({
          by: ["employeeId"],
          where: { employeeId: { in: ids }, date: inRange },
          _sum: { unitsProduced: true },
        }),
        db.monthlyTarget.findMany({
          where: { employeeId: { in: ids }, period: { in: range.monthPeriods } },
          select: { employeeId: true, targetUnits: true },
        }),
        db.qualityReport.groupBy({
          by: ["employeeId"],
          where: { employeeId: { in: ids }, date: inRange },
          _avg: { qualityScore: true },
        }),
        db.warningLetter.groupBy({
          by: ["employeeId"],
          where: {
            employeeId: { in: ids },
            status: "RELEASED",
            releasedAt: inRange,
          },
          _count: { _all: true },
        }),
        db.appraisalScore.findMany({
          where: { cycleId },
          select: { employeeId: true, managerFeedbackScore: true },
        }),
      ]);

    const totalBy = new Map(attTotal.map((g) => [g.employeeId, g._count._all]));
    const lateBy = new Map(attLate.map((g) => [g.employeeId, g._count._all]));
    const lateMinsBy = new Map(attLate.map((g) => [g.employeeId, g._sum.lateMinutes ?? 0]));
    const prodBy = new Map(prodSum.map((g) => [g.employeeId, g._sum.unitsProduced ?? 0]));
    const qualBy = new Map(qualAvg.map((g) => [g.employeeId, g._avg.qualityScore]));
    const warnBy = new Map(warnings.map((g) => [g.employeeId, g._count._all]));
    const feedbackBy = new Map(existing.map((s) => [s.employeeId, s.managerFeedbackScore]));
    // MonthlyTarget: sum across the month keys the period spans.
    const targetBy = new Map<string, number>();
    for (const t of targets)
      targetBy.set(t.employeeId, (targetBy.get(t.employeeId) ?? 0) + t.targetUnits);

    const incomplete: { employeeId: string; name: string; missing: string[] }[] = [];
    const scored: {
      employeeId: string;
      name: string;
      finalScore: number;
      punctuality: {
        value: number;
        frequencyScore: number;
        severityScore: number;
        lateCount: number;
        totalPunchDays: number;
        avgLateMinutesAmongLateDays: number;
      };
    }[] = [];
    let complete = 0;

    await Promise.all(
      employees.map(async (emp) => {
        const metrics: EmployeeMetrics = {
          totalPunchDays: totalBy.get(emp.id) ?? 0,
          lateCount: lateBy.get(emp.id) ?? 0,
          lateMinutesSum: lateMinsBy.get(emp.id) ?? 0,
          unitsProduced: prodBy.get(emp.id) ?? 0,
          targetUnits: targetBy.has(emp.id) ? targetBy.get(emp.id)! : null,
          qualityAvg: qualBy.get(emp.id) ?? null,
          feedbackScore: feedbackBy.get(emp.id) ?? null,
          releasedWarnings: warnBy.get(emp.id) ?? 0,
        };
        const result = computeAppraisal(emp.id, weights, metrics, { allowMissingFeedback });

        const componentScores = {
          ...result.componentData,
          weightedAverage: result.status === "COMPLETE" ? result.weightedAverage : null,
        } as unknown as Prisma.InputJsonValue;
        const componentMeta = {
          status: result.status,
          missingComponents: result.status === "INCOMPLETE" ? result.missingComponents : [],
        } as unknown as Prisma.InputJsonValue;
        const finalScore = result.status === "COMPLETE" ? result.finalScore : null;

        if (result.status === "COMPLETE") {
          complete += 1;
          const pd = result.componentData.punctuality;
          if (pd.breakdown) {
            scored.push({
              employeeId: emp.id,
              name: emp.name,
              finalScore: result.finalScore,
              punctuality: {
                value: pd.value ?? 0,
                frequencyScore: pd.breakdown.frequencyScore,
                severityScore: pd.breakdown.severityScore,
                lateCount: pd.breakdown.lateCount,
                totalPunchDays: pd.breakdown.totalPunchDays,
                avgLateMinutesAmongLateDays: pd.breakdown.avgLateMinutesAmongLateDays,
              },
            });
          }
        } else {
          incomplete.push({ employeeId: emp.id, name: emp.name, missing: result.missingComponents });
        }

        // Upsert preserves manager feedback (update touches only compute fields).
        await db.appraisalScore.upsert({
          where: { employeeId_cycleId: { employeeId: emp.id, cycleId } },
          create: {
            employeeId: emp.id,
            cycleId,
            finalScore,
            componentScoresJson: componentScores,
            componentDataJson: componentMeta,
          },
          update: {
            finalScore,
            componentScoresJson: componentScores,
            componentDataJson: componentMeta,
          },
        });
      }),
    );

    return NextResponse.json({
      ok: true,
      cycleId,
      total: employees.length,
      complete,
      incomplete,
      scored,
    });
  } catch (err) {
    console.error("[hr/appraisal/compute] failed:", err);
    return fail("SERVER_ERROR", "Could not compute scores", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
