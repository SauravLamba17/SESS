/**
 * Phase 12 — PDF render check.
 *
 * Renders all TEN report templates for real and asserts each produces a valid,
 * non-empty PDF (%PDF- magic bytes, %%EOF terminator, sane size).
 *
 * Why this is separate from prisma/verify-phase12.ts and why it is .cjs: Node
 * strips TypeScript types natively but does NOT compile JSX, and every template
 * is .tsx. So this script compiles lib/reports/**  to CommonJS in a temp
 * directory with the project's own `tsc`, then requires the output. It renders
 * the SAME template files the app serves — not a copy.
 *
 * Uses fixture result objects (no database): a template's job is to turn a
 * result object into a document, and that is exactly what is under test here.
 * The numbers themselves are verified against seeded data in verify-phase12.ts.
 *
 * Run:  node prisma/verify-phase12-pdf.cjs
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
// Emitted INSIDE the project (under node_modules/.cache) rather than the OS temp
// dir: the compiled templates require react/jsx-runtime and @react-pdf/renderer,
// and Node only finds those by walking up to the project's node_modules.
// Removed again in the finally block.
const OUT = path.join(ROOT, "node_modules", ".cache", "sess-pdf-check");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}

function compile() {
  const tsconfig = {
    compilerOptions: {
      target: "ES2020",
      module: "CommonJS",
      moduleResolution: "node",
      jsx: "react-jsx",
      esModuleInterop: true,
      skipLibCheck: true,
      // lib/reports uses explicit .ts/.tsx specifiers (the convention
      // tsconfig.json documents, so Node can run the modules directly).
      // rewriteRelativeImportExtensions turns those into .js on emit, which is
      // what makes the compiled output requireable here.
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      // pdf-layout.tsx returns Promise<Buffer>; this standalone config gets no
      // types from the project tsconfig, so Node's have to be named explicitly.
      types: ["node"],
      // The config lives in a temp dir, so @types cannot be found by walking up
      // from it — point at the project's own.
      typeRoots: [path.join(ROOT, "node_modules", "@types").replace(/\\/g, "/")],
      baseUrl: ROOT.replace(/\\/g, "/"),
      // registry.ts imports a TYPE from "@/lib/auth-types". Resolving the alias
      // keeps tsc happy; the emitted JS has no trace of it, because a type-only
      // import is erased entirely.
      paths: { "@/*": ["./*"] },
      lib: ["ES2020", "DOM"],
      strict: false,
      outDir: OUT,
      rootDir: path.join(ROOT, "lib"),
      noEmitOnError: false,
      declaration: false,
    },
    include: [
      path.join(ROOT, "lib/reports/**/*.ts").replace(/\\/g, "/"),
      path.join(ROOT, "lib/reports/**/*.tsx").replace(/\\/g, "/"),
      path.join(ROOT, "lib/payroll/format.ts").replace(/\\/g, "/"),
    ],
    // scope.ts / run.tsx pull in server-only Next internals; the templates and
    // the pure functions are all this check needs.
    exclude: [
      path.join(ROOT, "lib/reports/scope.ts").replace(/\\/g, "/"),
      path.join(ROOT, "lib/reports/run.tsx").replace(/\\/g, "/"),
    ],
  };
  const cfgPath = path.join(OUT, "tsconfig.pdfcheck.json");
  fs.writeFileSync(cfgPath, JSON.stringify(tsconfig, null, 2));
  // Run TypeScript's own entrypoint with node rather than the npx/tsc shim —
  // spawning a .cmd is blocked on Windows (EINVAL) and needs no shell here.
  const tscBin = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  try {
    execFileSync(process.execPath, [tscBin, "-p", cfgPath], { cwd: ROOT, stdio: "pipe" });
  } catch (err) {
    // tsc reports errors on stdout; surface them rather than a bare exit code.
    console.error(String(err.stdout ?? ""));
    throw new Error("template compilation failed — see the tsc output above");
  }
}

// ── Fixture results, one per report ────────────────────────────────────────

const META = {
  title: "Fixture Report",
  startLabel: "2026-06-01",
  endLabel: "2026-06-30",
  generatedBy: "HR · verify-phase12-pdf",
  generatedAt: new Date("2026-06-30T12:00:00Z"),
  scopeLabel: "Organisation-wide",
};

const money = "12345.67";
const payrollFixture = {
  finalizedRowCount: 2,
  excludedRowCount: 1,
  distinctEmployees: 2,
  months: ["2026-06"],
  components: {
    basic: money, hra: money, specialAllowance: money, bonus: money,
    reimbursements: money, pfEmployee: money, pfEmployer: money, esi: money,
    professionalTax: money, tds: money, loanDeduction: money,
  },
  totalGross: money, totalDeductions: money, totalNet: money, totalCostToCompany: money,
  byMonth: [{ month: "2026-06", gross: money, net: money, costToCompany: money, rows: 2 }],
  byDepartment: [
    { department: "Assembly", employees: 2, gross: money, net: money, costToCompany: money },
  ],
};

const headcountFixture = {
  totalActive: 3, departmentCount: 2, atRangeStart: 2, atRangeEnd: 2, netChange: 0,
  byDepartment: [
    { department: "Assembly", count: 2 },
    { department: "Quality", count: 1 },
  ],
  largestDepartment: { department: "Assembly", count: 2 },
};

const hiresExitsFixture = {
  hireCount: 1, exitCount: 1, netChange: 0, avgHeadcount: 2, attritionPct: 50,
  hires: [{ employeeId: "e1", name: "Alpha", employeeCode: "EMP-0001", department: "Assembly", date: new Date("2026-06-10") }],
  exits: [{ employeeId: "e3", name: "Charlie", employeeCode: "EMP-0003", department: "Quality", date: new Date("2026-06-20") }],
  byDepartment: [{ department: "Assembly", hires: 1, exits: 0, net: 1 }],
  byMonth: [{ month: "2026-06", hires: 1, exits: 1 }],
};

const appraisalFixture = {
  scoredCount: 3, average: 66, median: 71, min: 35, max: 92,
  bands: [
    { label: "0–40", min: 0, max: 40, count: 1, sharePct: 33.3 },
    { label: "40–60", min: 40, max: 60, count: 0, sharePct: 0 },
    { label: "60–80", min: 60, max: 80, count: 1, sharePct: 33.3 },
    { label: "80–100", min: 80, max: 100, count: 1, sharePct: 33.3 },
  ],
  byDepartment: [{ department: "Assembly", count: 2, average: 81.5 }],
  byCycle: [{ cyclePeriod: "2026-Q2", count: 3, average: 66 }],
};

const funnelFixture = {
  totalApplications: 5, rejectedCount: 1, rejectedPct: 20, hiredCount: 1,
  overallConversionPct: 20, avgTimeToHireDays: 10, medianTimeToHireDays: 10,
  stages: [
    { stage: "APPLIED", atStage: 1, reached: 4, conversionFromPrevPct: null, ofTotalPct: 80 },
    { stage: "SCREENING", atStage: 1, reached: 3, conversionFromPrevPct: 75, ofTotalPct: 60 },
    { stage: "INTERVIEW", atStage: 1, reached: 2, conversionFromPrevPct: 66.7, ofTotalPct: 40 },
    { stage: "OFFER", atStage: 0, reached: 1, conversionFromPrevPct: 50, ofTotalPct: 20 },
    { stage: "HIRED", atStage: 1, reached: 1, conversionFromPrevPct: 100, ofTotalPct: 20 },
  ],
  byDepartment: [{ department: "Assembly", applications: 5, hired: 1, rejected: 1, conversionPct: 20 }],
};

const FIXTURES = [
  ["headcount", "HeadcountPdf", headcountFixture],
  [
    "attendance",
    "AttendancePdf",
    {
      totalPunchDays: 4, lateCount: 1, onTimeCount: 3, latePct: 25, onTimePct: 75,
      orgAvgPunchInMinutes: 0, orgAvgPunchIn: "00:00",
      // Exercise the overnight branch: the circular note and the ○ markers.
      orgAvgPunchInMethod: "circular", hasOvernightShift: true,
      expectedWeekdayCount: 88, noPunchDays: 84,
      byEmployee: [
        { employeeId: "e1", name: "Alpha", employeeCode: "EMP-0001", department: "Assembly", punchDays: 3, lateCount: 1, onTimeCount: 2, latePct: 33.3, avgLateMinutes: 30, avgPunchInMinutes: 580, avgPunchIn: "09:40", avgPunchInMethod: "linear" },
        { employeeId: "e2", name: "Night", employeeCode: "EMP-0002", department: "Assembly", punchDays: 2, lateCount: 2, onTimeCount: 0, latePct: 100, avgLateMinutes: 360, avgPunchInMinutes: 0, avgPunchIn: "00:00", avgPunchInMethod: "circular" },
        { employeeId: "e4", name: "Delta", employeeCode: "EMP-0004", department: "Quality", punchDays: 0, lateCount: 0, onTimeCount: 0, latePct: null, avgLateMinutes: null, avgPunchInMinutes: null, avgPunchIn: null, avgPunchInMethod: "linear" },
      ],
      byDepartment: [
        { department: "Assembly", employees: 2, punchDays: 4, lateCount: 1, latePct: 25, avgPunchInMinutes: 0, avgPunchIn: "00:00", avgPunchInMethod: "circular" },
        { department: "Quality", employees: 1, punchDays: 0, lateCount: 0, latePct: null, avgPunchInMinutes: null, avgPunchIn: null, avgPunchInMethod: "linear" },
      ],
    },
  ],
  ["hires-exits", "HiresExitsPdf", hiresExitsFixture],
  [
    "production",
    "ProductionPdf",
    {
      totalActual: 190, totalTarget: 210, achievementPct: 90.5, variance: -20,
      metTargetCount: 1, belowTargetCount: 1,
      byEmployee: [
        { employeeId: "e1", name: "Alpha", employeeCode: "EMP-0001", department: "Assembly", days: 2, actual: 160, target: 160, achievementPct: 100, variance: 0 },
        { employeeId: "e4", name: "Delta", employeeCode: "EMP-0004", department: "Quality", days: 0, actual: 0, target: 0, achievementPct: null, variance: 0 },
      ],
      byDepartment: [
        { department: "Assembly", employees: 2, actual: 190, target: 210, achievementPct: 90.5, variance: -20 },
      ],
    },
  ],
  ["appraisal-distribution", "AppraisalDistributionPdf", appraisalFixture],
  ["payroll-cost", "PayrollCostPdf", payrollFixture],
  ["recruitment-funnel", "RecruitmentFunnelPdf", funnelFixture],
  [
    "idle-time",
    "IdleTimePdf",
    {
      totalIdleMinutes: 80, totalActiveMinutes: 160, totalMinutes: 240, activePct: 66.7,
      employeesWithData: 2, employeesInScope: 4,
      byEmployee: [
        { employeeId: "e1", name: "Alpha", employeeCode: "EMP-0001", department: "Assembly", daysWithData: 1, idleMinutes: 20, activeMinutes: 100, totalMinutes: 120, activePct: 83.3 },
      ],
      byDepartment: [
        { department: "Assembly", employeesTracked: 2, idleMinutes: 80, activeMinutes: 160, totalMinutes: 240, activePct: 66.7 },
      ],
    },
  ],
  [
    "warning-letters",
    "WarningLettersPdf",
    {
      releasedCount: 3, excludedDraftCount: 1, employeesAffected: 2,
      repeatEmployees: [{ employeeId: "e1", name: "Alpha", employeeCode: "EMP-0001", department: "Assembly", count: 2 }],
      byDepartment: [{ department: "Assembly", count: 3, sharePct: 100 }],
      byMonth: [{ month: "2026-05", count: 0 }, { month: "2026-06", count: 3 }],
      hasTrend: true,
      busiestMonth: { month: "2026-06", count: 3 },
    },
  ],
  [
    "my-data",
    "MyDataPdf",
    {
      profile: {
        name: "Alpha", employeeCode: "EMP-0001", department: "Assembly",
        designation: "Operator", joiningDate: new Date("2025-01-10"),
        emergencyContact: "Next of kin · 99999", email: "a@example.com",
        shiftName: "Standard", managerName: "Manager", active: true, offboardedAt: null,
      },
      attendance: [
        { date: new Date("2026-06-01"), checkIn: new Date("2026-06-01T09:00:00"), checkOut: null, lateFlag: false, lateMinutes: null, channel: "WEB", flaggedForReview: false },
      ],
      attendanceSummary: { days: 1, late: 0, flagged: 0 },
      leave: [{ startDate: new Date("2026-06-10"), endDate: new Date("2026-06-11"), reason: "Personal", status: "APPROVED", createdAt: new Date("2026-06-01") }],
      production: [{ date: new Date("2026-06-01"), unitsProduced: 100, targetUnits: 80 }],
      productionSummary: { days: 1, actual: 100, target: 80 },
      quality: [{ date: new Date("2026-06-01"), defectCount: 1, qualityScore: 95 }],
      qualitySummary: { reviews: 1, averageScore: 95 },
      appraisals: [{ cyclePeriod: "2026-Q2", published: true, excluded: false, finalScore: 88, managerFeedback: "Solid" }],
      warnings: [{ reason: "Late repeatedly", status: "RELEASED", releasedAt: new Date("2026-06-05"), acknowledged: true, attestedAt: new Date("2026-06-06") }],
      consents: [{ consentType: "IDLE_TRACKING", givenOn: new Date("2026-01-01"), retentionExpiry: null }],
      expenses: [{ date: new Date("2026-06-03"), category: "TRAVEL", amount: "1250.00", description: "Site visit", status: "APPROVED" }],
      payslips: [{ month: "2026-06", status: "FINALIZED", net: "47125.00" }],
      counts: { Attendance: 1, Leave: 1, Production: 1, Quality: 1, Appraisals: 1, Warnings: 1, Consents: 1, Expenses: 1, Payslips: 1 },
      range: { startLabel: "2026-06-01", endLabel: "2026-06-30" },
    },
  ],
  [
    "board-summary",
    "BoardSummaryPdf",
    {
      headlines: [
        { label: "Active headcount", value: "3", source: "Headcount & Org Summary" },
        { label: "Attrition (period)", value: "50%", source: "New Hires & Exits" },
      ],
      headcount: headcountFixture,
      hiresExits: hiresExitsFixture,
      appraisal: appraisalFixture,
      payroll: payrollFixture,
      recruitment: funnelFixture,
    },
  ],
];

async function main() {
  console.log(`compiling lib/reports → ${OUT}`);
  compile();
  console.log("compiled.\n");

  const React = require("react");
  const { renderReport } = require(path.join(OUT, "reports", "pdf-layout.js"));

  for (const [file, exportName, fixture] of FIXTURES) {
    const mod = require(path.join(OUT, "reports", "pdf", `${file}.js`));
    const Component = mod[exportName];
    if (typeof Component !== "function") {
      check(`${file}: template exported`, false, `${exportName} is not a function`);
      continue;
    }
    try {
      const buf = await renderReport(React.createElement(Component, { r: fixture, meta: { ...META, title: file } }));
      const head = buf.subarray(0, 5).toString("latin1");
      const tail = buf.subarray(-1024).toString("latin1");
      check(
        `${file}: valid non-empty PDF`,
        Buffer.isBuffer(buf) && buf.length > 1000 && head === "%PDF-" && tail.includes("%%EOF"),
        `${buf.length} bytes, header "${head}", EOF ${tail.includes("%%EOF")}`,
      );
    } catch (err) {
      check(`${file}: renders without throwing`, false, err && err.message);
    }
  }

  console.log(`\n══ PDF RESULT: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("PDF CHECK CRASHED:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(OUT, { recursive: true, force: true });
    console.log("temp build removed");
  });
