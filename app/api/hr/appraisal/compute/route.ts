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
import { fail } from "@/lib/api/response";
import { lockCycleForWrite } from "@/lib/appraisal/cycle-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The $transaction below is capped at 60s and upserts one row PER EMPLOYEE in a
// loop, so its duration scales with headcount. 90 leaves Prisma's own 60s
// timeout room to fire first and return a real error, instead of Vercel killing
// the invocation mid-transaction and returning a bare 504.
// Set explicitly rather than inheriting the platform default, so the ceiling
// stays tied to the transaction's own timeout if that default ever changes.
export const maxDuration = 90;

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

export async function POST(req: NextRequest) {
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

    // Computed first, written second. The scoring below is pure; collecting the
    // payloads lets every write happen together inside ONE locked transaction,
    // which is what stops a concurrent Publish from interleaving and stops a
    // mid-run failure from leaving a half-computed cycle behind.
    const pending: {
      employeeId: string;
      finalScore: number | null;
      componentScores: Prisma.InputJsonValue;
      componentMeta: Prisma.InputJsonValue;
    }[] = [];

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

        pending.push({
          employeeId: emp.id,
          finalScore,
          componentScores,
          componentMeta,
        });
      }),
    );

    // The cycle is locked FIRST, then every score is written. A Publish that
    // arrives mid-compute waits for this transaction; one that already
    // committed makes the lock report PUBLISHED and rolls the whole compute
    // back, so a published score can never be silently overwritten after the
    // employee was told it was final. See lib/appraisal/cycle-lock.ts.
    //
    // Timeout raised from Prisma's 5s default: this is one upsert per employee
    // (a known N+1, flagged separately for batching) and a large org would
    // otherwise abort a legitimate run.
    const writeOutcome = await db.$transaction(
      async (tx) => {
        const gate = await lockCycleForWrite(tx, cycleId);
        if (!gate.ok) return gate.reason;

        for (const p of pending) {
          // Upsert preserves manager feedback (update touches only compute fields).
          await tx.appraisalScore.upsert({
            where: { employeeId_cycleId: { employeeId: p.employeeId, cycleId } },
            create: {
              employeeId: p.employeeId,
              cycleId,
              finalScore: p.finalScore,
              componentScoresJson: p.componentScores,
              componentDataJson: p.componentMeta,
            },
            update: {
              finalScore: p.finalScore,
              componentScoresJson: p.componentScores,
              componentDataJson: p.componentMeta,
            },
          });
        }
        return null;
      },
      { timeout: 60_000 },
    );

    if (writeOutcome === "NOT_FOUND") return fail("NOT_FOUND", "Cycle not found", 404);
    if (writeOutcome === "PUBLISHED")
      return fail("PUBLISHED", "Cycle is published; scores are immutable", 409);

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
