/**
 * READ-ONLY inspector for the full system walkthrough. Deletes nothing,
 * writes nothing. Verifies each step against the database directly rather
 * than trusting an on-screen message.
 *
 * Run:  npx tsx prisma/walkthrough-check.ts <section>
 * Sections: accounts | attendance | leave | production | quality | targets
 *           appraisal | warnings | payroll | recruitment | engagement
 *           idle | audit | all
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const section = (process.argv[2] ?? "accounts").toLowerCase();

const hr = (t: string) => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 52 - t.length))}`);
const j = (v: unknown) => JSON.stringify(v);

async function accounts() {
  hr("USERS + EMPLOYEES");
  const users = await db.user.findMany({
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          name: true,
          department: true,
          designation: true,
          managerId: true,
          active: true,
          email: true,
          shiftId: true,
          joiningDate: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (users.length === 0) console.log("  (no User rows)");
  for (const u of users) {
    const e = u.employee;
    console.log(
      `  ${u.role.padEnd(11)} clerkId=${u.clerkId}\n` +
        `              emp=${e ? `${e.employeeCode}/${e.name} dept=${e.department} mgr=${e.managerId ?? "—"} shift=${e.shiftId ?? "NONE"} active=${e.active}` : "— NO EMPLOYEE ROW —"}`,
    );
  }

  const orphanEmployees = await db.employee.findMany({
    where: { user: null },
    select: { employeeCode: true, name: true, managerId: true, shiftId: true },
  });
  if (orphanEmployees.length) {
    hr("EMPLOYEES WITH NO LINKED USER (cannot sign in)");
    for (const e of orphanEmployees)
      console.log(`  ${e.employeeCode}/${e.name} mgr=${e.managerId ?? "—"} shift=${e.shiftId ?? "NONE"}`);
  }

  hr("REPORTING TREE");
  const emps = await db.employee.findMany({
    select: { id: true, employeeCode: true, name: true, managerId: true },
    orderBy: { employeeCode: "asc" },
  });
  const byId = new Map(emps.map((e) => [e.id, e]));
  for (const e of emps) {
    const m = e.managerId ? byId.get(e.managerId) : null;
    console.log(`  ${e.employeeCode}/${e.name} → manager: ${m ? `${m.employeeCode}/${m.name}` : "—"}`);
  }

  hr("SHIFTS");
  for (const s of await db.shift.findMany())
    console.log(`  ${s.name}: ${s.startTime}-${s.endTime} grace=${s.gracePeriodMinutes}m active=${s.active} id=${s.id}`);
}

async function attendance() {
  hr("ATTENDANCE (most recent 15)");
  const rows = await db.attendance.findMany({
    include: { employee: { select: { employeeCode: true, name: true, shift: { select: { name: true, startTime: true, gracePeriodMinutes: true } } } } },
    orderBy: { checkIn: "desc" },
    take: 15,
  });
  if (!rows.length) console.log("  (none)");
  for (const a of rows) {
    console.log(
      `  ${a.employee.employeeCode}/${a.employee.name}  date=${a.date.toISOString().slice(0, 10)}\n` +
        `     in=${a.checkIn?.toISOString() ?? "—"}  out=${a.checkOut?.toISOString() ?? "—"}\n` +
        `     lateFlag=${a.lateFlag}  lateMinutes=${a.lateMinutes ?? "null"}  channel=${a.channel}\n` +
        `     shift=${a.employee.shift ? `${a.employee.shift.name} ${a.employee.shift.startTime} grace ${a.employee.shift.gracePeriodMinutes}m` : "NONE"}\n` +
        `     note=${j(a.checkInNote)}  ip=${a.ipAddress ?? "—"} lat=${a.lat ?? "—"} long=${a.long ?? "—"}`,
    );
  }
}

async function leave() {
  hr("LEAVE REQUESTS");
  const rows = await db.leaveRequest.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  if (!rows.length) console.log("  (none)");
  for (const l of rows)
    console.log(
      `  ${l.employee.employeeCode}/${l.employee.name} ${l.startDate.toISOString().slice(0, 10)}→${l.endDate.toISOString().slice(0, 10)} ` +
        `status=${l.status} approvedBy=${l.approvedBy ?? "—"} reason=${j(l.reason)}`,
    );
}

async function production() {
  hr("PRODUCTION");
  const rows = await db.production.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
    orderBy: { date: "desc" },
    take: 15,
  });
  if (!rows.length) console.log("  (none)");
  for (const p of rows)
    console.log(`  ${p.employee.employeeCode}/${p.employee.name} ${p.date.toISOString().slice(0, 10)} units=${p.unitsProduced} id=${p.id}`);
  console.log(`  TOTAL production rows: ${await db.production.count()}`);
}

async function quality() {
  hr("QUALITY REPORTS");
  const rows = await db.qualityReport.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
    orderBy: { date: "desc" },
    take: 15,
  });
  if (!rows.length) console.log("  (none)");
  for (const q of rows)
    console.log(`  ${q.employee.employeeCode}/${q.employee.name} ${q.date.toISOString().slice(0, 10)} score=${q.qualityScore} defects=${q.defectCount} by=${q.reviewedBy ?? "—"}`);
}

async function targets() {
  hr("MONTHLY TARGETS");
  const rows = await db.monthlyTarget.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
    orderBy: { period: "desc" },
  });
  if (!rows.length) console.log("  (none)");
  for (const t of rows)
    console.log(`  ${t.employee.employeeCode}/${t.employee.name} ${t.period} target=${t.targetUnits} id=${t.id}`);
}

async function appraisal() {
  hr("APPRAISAL FORMULA");
  for (const f of await db.appraisalFormula.findMany())
    console.log(`  dept=${f.department ?? "GLOBAL"} weights=${j(f.weightsJson)} updatedBy=${f.updatedBy}`);
  hr("APPRAISAL CYCLES");
  for (const c of await db.appraisalCycle.findMany({ orderBy: { createdAt: "desc" } }))
    console.log(`  ${c.id} period=${c.period} published=${c.published} weights=${j(c.weightsJson)}`);
  hr("APPRAISAL SCORES");
  const rows = await db.appraisalScore.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
  });
  if (!rows.length) console.log("  (none)");
  for (const s of rows)
    console.log(
      `  ${s.employee.employeeCode}/${s.employee.name} final=${s.finalScore ?? "null"} excluded=${s.excluded}\n` +
        `     components=${j(s.componentScoresJson)} data=${j(s.componentDataJson)}`,
    );
}

async function warnings() {
  hr("WARNING LETTERS");
  const rows = await db.warningLetter.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!rows.length) console.log("  (none)");
  for (const w of rows)
    console.log(
      `  ${w.employee.employeeCode}/${w.employee.name} status=${w.status} acknowledged=${w.acknowledged}\n` +
        `     issuedBy=${w.issuedBy} releasedBy=${w.releasedBy ?? "—"} attestedName=${j(w.attestedName)} attestedAt=${w.attestedAt?.toISOString() ?? "—"} ip=${w.attestedIp ?? "—"}`,
    );
}

async function payroll() {
  hr("SALARY STRUCTURES (current)");
  for (const s of await db.salaryStructure.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
  }))
    console.log(`  ${s.employee.employeeCode}/${s.employee.name} basic=${s.basic} hra=${s.hra} special=${s.specialAllowance} from=${s.effectiveFrom.toISOString().slice(0, 10)} by=${s.setBy}`);

  hr("SALARY STRUCTURE HISTORY (versions)");
  const hist = await db.salaryStructureHistory.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
    orderBy: [{ employeeId: "asc" }, { versionNumber: "asc" }],
  });
  if (!hist.length) console.log("  (none)");
  for (const h of hist)
    console.log(`  ${h.employee.employeeCode}/${h.employee.name} v${h.versionNumber} basic=${h.basic} ${h.effectiveFrom.toISOString().slice(0, 10)}→${h.effectiveTo.toISOString().slice(0, 10)}`);

  hr("PAYROLL ROWS");
  const rows = await db.payroll.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
    orderBy: [{ month: "desc" }, { finalizedAt: "asc" }],
  });
  if (!rows.length) console.log("  (none)");
  for (const p of rows)
    console.log(
      `  ${p.employee.employeeCode}/${p.employee.name} ${p.month} status=${p.status} settlement=${p.isFinalSettlement} adjFor=${p.adjustmentForPayrollId ?? "—"}\n` +
        `     days=${p.daysWorked}/${p.daysInMonth} basic=${p.basic} gross=${p.gross} ded=${p.deductions} loan=${p.loanDeduction} net=${p.net} tds=${p.tds} tdsSrc=${j(p.tdsSource)}\n` +
        `     finalizedAt=${p.finalizedAt?.toISOString() ?? "—"} id=${p.id}`,
    );

  hr("SALARY ADVANCES");
  for (const a of await db.salaryAdvance.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
  }))
    console.log(`  ${a.employee.employeeCode}/${a.employee.name} principal=${a.principalAmount} monthly=${a.monthlyDeduction} remaining=${a.remainingBalance} status=${a.status}`);

  hr("EXPENSE CLAIMS");
  for (const c of await db.expenseClaim.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
  }))
    console.log(`  ${c.employee.employeeCode}/${c.employee.name} ${c.date.toISOString().slice(0, 10)} amt=${c.amount} status=${c.status} inPayroll=${c.includedInPayrollId ?? "—"}`);
}

async function recruitment() {
  hr("JOB REQUISITIONS");
  for (const r of await db.jobRequisition.findMany({ orderBy: { createdAt: "desc" } }))
    console.log(`  ${r.id} ${j(r.title)} dept=${r.department} status=${r.status} openings=${r.openings}`);

  hr("CANDIDATES + APPLICATIONS");
  const apps = await db.application.findMany({
    include: { candidate: true, jobRequisition: { select: { title: true, department: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!apps.length) console.log("  (none)");
  for (const a of apps)
    console.log(
      `  ${a.candidate.name} <${a.candidate.email}> → ${j(a.jobRequisition.title)}\n` +
        `     stage=${a.stage} applied=${a.createdAt.toISOString().slice(0, 10)} resume=${j(a.candidate.resumeUrl)}\n` +
        `     talentPool=${a.candidate.talentPoolConsent} scheduledDeletion=${a.candidate.scheduledDeletionAt?.toISOString().slice(0, 10) ?? "—"} appId=${a.id}`,
    );

  hr("INTERVIEW FEEDBACK");
  for (const f of await db.interviewFeedback.findMany({ orderBy: [{ applicationId: "asc" }, { roundNumber: "asc" }] }))
    console.log(`  app=${f.applicationId} round=${f.roundNumber} rating=${f.rating}/5 by=${f.interviewerUserId} date=${f.interviewDate.toISOString().slice(0, 10)}`);

  hr("OFFERS");
  for (const o of await db.offer.findMany())
    console.log(
      `  ${o.id} app=${o.applicationId} status=${o.status}\n` +
        `     basic=${o.proposedBasic} hra=${o.proposedHra} special=${o.proposedSpecialAllowance} desig=${j(o.proposedDesignation)} dept=${j(o.proposedDepartment)}\n` +
        `     joining=${o.joiningDate.toISOString().slice(0, 10)} createdBy=${o.createdBy} approvedBy=${o.approvedBy ?? "—"}`,
    );
}

async function engagement() {
  hr("HOLIDAYS");
  for (const h of await db.holiday.findMany({ orderBy: { date: "asc" } }))
    console.log(`  ${h.date.toISOString().slice(0, 10)} ${j(h.name)}`);
  hr("SHOUT-OUTS");
  const s = await db.shoutOut.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  if (!s.length) console.log("  (none)");
  for (const x of s) console.log(`  from=${x.fromEmployeeId} to=${x.toEmployeeId} ${j(x.message)}`);
  hr("PULSE SURVEYS");
  for (const p of await db.pulseSurvey.findMany({ orderBy: { createdAt: "desc" } }))
    console.log(`  ${p.id} ${j(p.question)} closesAt=${p.closesAt?.toISOString().slice(0, 10) ?? "—"}`);
  hr("PULSE RESPONSES (anonymous) vs TURNSTILE");
  console.log(`  PulseSurveyResponse rows (answers, NO employeeId by design): ${await db.pulseSurveyResponse.count()}`);
  console.log(`  SurveyResponseRecord rows (turnstile only):                 ${await db.surveyResponseRecord.count()}`);
  for (const r of await db.pulseSurveyResponse.findMany({ take: 10 }))
    console.log(`     survey=${r.surveyId} rating=${r.ratingValue}  (keys: ${Object.keys(r).join(",")})`);
}

async function idle() {
  hr("CONSENT RECORDS");
  const c = await db.consentRecord.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
  });
  if (!c.length) console.log("  (none)");
  for (const x of c)
    console.log(`  ${x.employee.employeeCode}/${x.employee.name} type=${x.consentType} givenOn=${x.givenOn.toISOString().slice(0, 10)} expiry=${x.retentionExpiry?.toISOString().slice(0, 10) ?? "—"}`);

  hr("AGENT TOKENS");
  const t = await db.agentToken.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
  });
  if (!t.length) console.log("  (none)");
  for (const x of t)
    console.log(`  ${x.employee.employeeCode}/${x.employee.name} lastSeenAt=${x.lastSeenAt?.toISOString() ?? "never"} active=${x.active}`);

  hr("IDLE LOGS");
  const l = await db.idleLog.findMany({
    include: { employee: { select: { employeeCode: true, name: true } } },
    orderBy: { date: "desc" },
    take: 10,
  });
  if (!l.length) console.log("  (none)");
  for (const x of l)
    console.log(`  ${x.employee.employeeCode}/${x.employee.name} ${x.date.toISOString().slice(0, 10)} idle=${x.idleMinutes}m active=${x.activeMinutes}m`);

  hr("SYSTEM SETTINGS");
  const s = await db.systemSetting.findMany();
  if (!s.length) console.log("  (none — every toggle is at its default)");
  for (const x of s) console.log(`  ${x.key} = ${j(x.value)}  (by ${x.updatedBy})`);
}

async function audit() {
  hr("AUDIT LOG — action counts");
  const g = await db.auditLog.groupBy({ by: ["action"], _count: { _all: true } });
  for (const r of g.sort((a, b) => b._count._all - a._count._all))
    console.log(`  ${String(r._count._all).padStart(4)}  ${r.action}`);
  hr("AUDIT LOG — most recent 25");
  for (const a of await db.auditLog.findMany({ orderBy: { timestamp: "desc" }, take: 25 }))
    console.log(`  ${a.timestamp.toISOString().slice(0, 19)}  ${a.action.padEnd(32)} actor=${a.actorUserId}\n        target=${a.targetEntity}`);
  console.log(`\n  TOTAL AuditLog rows: ${await db.auditLog.count()}`);
}

const SECTIONS: Record<string, () => Promise<void>> = {
  accounts, attendance, leave, production, quality, targets,
  appraisal, warnings, payroll, recruitment, engagement, idle, audit,
};

async function main() {
  if (section === "all") {
    for (const fn of Object.values(SECTIONS)) await fn();
    return;
  }
  const fn = SECTIONS[section];
  if (!fn) {
    console.error(`Unknown section "${section}". Options: ${Object.keys(SECTIONS).join(", ")}, all`);
    process.exitCode = 1;
    return;
  }
  await fn();
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("CHECK FAILED:", e);
    await db.$disconnect();
    process.exit(1);
  });
