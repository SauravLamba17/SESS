/**
 * Payslip and Form 16 (Part B) PDF templates.
 *
 * Both documents FORMAT already-stored figures. Nothing here computes a tax
 * slab, an exemption, or a TDS amount — every rupee printed was either entered
 * by HR (sourced from the company's CA) or produced by lib/payroll/compute.ts
 * from HR-entered inputs.
 *
 * Every amount arrives as an exact decimal STRING (Decimal.toFixed(2)) and is
 * formatted by string manipulation, so no figure passes through a JS Number
 * even on the display path.
 */
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

// ponytail: single-tenant constant. Move to an env var / an Organisation row
// when SESS ever serves more than one company.
const COMPANY_NAME = "Simplen";

import { inr, periodLabel } from "./format";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: "#1a1a1a", fontFamily: "Helvetica" },

  company: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#111" },
  docTitle: { fontSize: 10, marginTop: 3, color: "#555", letterSpacing: 1 },
  rule: { borderBottomWidth: 1.5, borderBottomColor: "#111", marginTop: 8, marginBottom: 14 },

  metaGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 16 },
  metaCell: { width: "50%", flexDirection: "row", marginBottom: 5 },
  metaLabel: { width: 95, color: "#666" },
  metaValue: { fontFamily: "Helvetica-Bold" },

  columns: { flexDirection: "row", gap: 14 },
  column: { flex: 1, borderWidth: 1, borderColor: "#ddd" },
  colHead: {
    backgroundColor: "#f2f2f2",
    paddingVertical: 5,
    paddingHorizontal: 8,
    fontFamily: "Helvetica-Bold",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  lineAlt: { backgroundColor: "#fafafa" },
  amount: { fontFamily: "Helvetica-Bold" },
  subtotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    backgroundColor: "#f2f2f2",
    fontFamily: "Helvetica-Bold",
  },

  netBox: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#111",
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  netLabel: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  netValue: { fontSize: 14, fontFamily: "Helvetica-Bold" },

  note: { marginTop: 10, fontSize: 7.5, color: "#777", lineHeight: 1.5 },
  banner: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#b8860b",
    backgroundColor: "#fdf6e3",
    padding: 8,
    fontSize: 8,
    color: "#7a5c00",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 7.5,
    color: "#888",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 6,
  },

  // Form 16 month table
  tHead: {
    flexDirection: "row",
    backgroundColor: "#f2f2f2",
    borderBottomWidth: 1,
    borderBottomColor: "#ccc",
    paddingVertical: 5,
    fontFamily: "Helvetica-Bold",
  },
  tRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#eee",
  },
  cMonth: { width: "40%", paddingHorizontal: 8 },
  cNum: { width: "30%", paddingHorizontal: 8, textAlign: "right" },
});

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

function Line({ label, value, alt }: { label: string; value: string; alt?: boolean }) {
  return (
    <View style={alt ? [s.line, s.lineAlt] : s.line}>
      <Text>{label}</Text>
      <Text style={s.amount}>{inr(value)}</Text>
    </View>
  );
}

// ── Payslip ────────────────────────────────────────────────────────────────

export interface PayslipData {
  employeeName: string;
  employeeCode: string;
  department: string;
  designation: string | null;
  pfUan: string | null;
  period: string; // "YYYY-MM"
  daysWorked: number;
  daysInMonth: number;
  basic: string;
  hra: string;
  specialAllowance: string;
  bonus: string;
  reimbursements: string;
  pfEmployee: string;
  pfEmployer: string;
  esi: string;
  professionalTax: string;
  tds: string;
  tdsSource: string;
  loanDeduction: string;
  gross: string;
  deductions: string;
  net: string;
  isFinalSettlement: boolean;
  finalizedAt: Date | null;
  /** Set when this slip is a correction — carries the original it adjusts. */
  adjustmentFor: { period: string; finalizedAt: Date | null } | null;
}

function Payslip({ d }: { d: PayslipData }) {
  return (
    <Document
      title={`Payslip ${d.employeeCode} ${d.period}`}
      author={COMPANY_NAME}
      subject={`Salary slip for ${periodLabel(d.period)}`}
    >
      <Page size="A4" style={s.page}>
        <Text style={s.company}>{COMPANY_NAME}</Text>
        <Text style={s.docTitle}>
          {d.adjustmentFor
            ? "CORRECTED PAYSLIP — ADJUSTMENT"
            : d.isFinalSettlement
              ? "FULL & FINAL SETTLEMENT"
              : "SALARY SLIP"}{" "}
          · {periodLabel(d.period).toUpperCase()}
        </Text>
        <View style={s.rule} />

        <View style={s.metaGrid}>
          <Meta label="Employee" value={d.employeeName} />
          <Meta label="Employee code" value={d.employeeCode} />
          <Meta label="Department" value={d.department} />
          <Meta label="Designation" value={d.designation ?? "—"} />
          <Meta label="PF UAN" value={d.pfUan ?? "—"} />
          <Meta label="Pay period" value={periodLabel(d.period)} />
          {/* Days are meaningless on a correction — it pays a difference, not
              a number of days. Show what it corrects instead. */}
          {d.adjustmentFor ? (
            <Meta
              label="Corrects"
              value={
                d.adjustmentFor.finalizedAt
                  ? `${d.adjustmentFor.period} payslip, finalized ${d.adjustmentFor.finalizedAt
                      .toISOString()
                      .slice(0, 10)}`
                  : `${d.adjustmentFor.period} payslip`
              }
            />
          ) : (
            <Meta label="Days paid" value={`${d.daysWorked} of ${d.daysInMonth}`} />
          )}
          <Meta
            label="Finalized on"
            value={d.finalizedAt ? d.finalizedAt.toISOString().slice(0, 10) : "—"}
          />
        </View>

        {d.adjustmentFor && (
          <View style={s.banner}>
            <Text>
              CORRECTED PAYSLIP — this document does NOT replace your original{" "}
              {d.adjustmentFor.period} payslip
              {d.adjustmentFor.finalizedAt
                ? `, dated ${d.adjustmentFor.finalizedAt.toISOString().slice(0, 10)}`
                : ""}
              , which stands exactly as issued. Every figure below is the
              ADDITIONAL amount arising from the correction. A negative figure
              is a recovery of an amount previously overpaid. Read this
              alongside the original, not instead of it.
            </Text>
          </View>
        )}

        {d.isFinalSettlement && !d.adjustmentFor && (
          <View style={s.banner}>
            <Text>
              FULL &amp; FINAL SETTLEMENT — this is the closing payment for this
              employment. Earnings are pro-rated to the last working day, and any
              outstanding salary advance has been recovered in full below.
            </Text>
          </View>
        )}

        {!d.adjustmentFor && d.daysWorked < d.daysInMonth && (
          <Text style={[s.note, { marginTop: 8, marginBottom: 2 }]}>
            Earnings below are pro-rated for {d.daysWorked} of {d.daysInMonth}{" "}
            days.
          </Text>
        )}

        <View style={s.columns}>
          <View style={s.column}>
            <Text style={s.colHead}>
              {d.adjustmentFor ? "EARNINGS — ADJUSTMENT" : "EARNINGS"}
            </Text>
            <Line label="Basic" value={d.basic} />
            <Line label="House Rent Allowance" value={d.hra} alt />
            <Line label="Special Allowance" value={d.specialAllowance} />
            <View style={s.subtotal}>
              <Text>Gross Earnings</Text>
              <Text>{inr(d.gross)}</Text>
            </View>
          </View>

          <View style={s.column}>
            <Text style={s.colHead}>DEDUCTIONS</Text>
            <Line label="Provident Fund (employee)" value={d.pfEmployee} />
            <Line label="ESI" value={d.esi} alt />
            <Line label="Professional Tax" value={d.professionalTax} />
            <Line label="TDS (income tax)" value={d.tds} alt />
            <Line
              label={
                d.isFinalSettlement
                  ? "Salary Advance (settled in full)"
                  : "Salary Advance Recovery"
              }
              value={d.loanDeduction}
            />
            <View style={s.subtotal}>
              <Text>Total Deductions</Text>
              <Text>{inr(d.deductions)}</Text>
            </View>
          </View>
        </View>

        {/* Additions paid after deductions — not part of taxable gross. */}
        <View style={[s.columns, { marginTop: 14 }]}>
          <View style={s.column}>
            <Text style={s.colHead}>ADDITIONS</Text>
            <Line label="Bonus" value={d.bonus} />
            <Line label="Expense Reimbursements" value={d.reimbursements} alt />
          </View>
          <View style={s.column}>
            <Text style={s.colHead}>EMPLOYER CONTRIBUTION (not deducted)</Text>
            <Line label="Provident Fund (employer)" value={d.pfEmployer} />
            <View style={[s.line, { paddingTop: 8 }]}>
              <Text style={{ color: "#777", fontSize: 7.5 }}>
                Recorded for statutory purposes. Does not affect your net pay.
              </Text>
            </View>
          </View>
        </View>

        <View style={s.netBox}>
          <Text style={s.netLabel}>
            {d.adjustmentFor
              ? d.net.startsWith("-")
                ? "NET RECOVERABLE"
                : "ADDITIONAL NET PAY"
              : "NET PAY"}
          </Text>
          <Text style={s.netValue}>INR {inr(d.net)}</Text>
        </View>

        <Text style={s.note}>
          Net pay = Gross Earnings − Total Deductions + Bonus + Reimbursements.
          Total Deductions includes any salary-advance recovery.{"\n"}
          TDS shown above is the figure recorded by HR from the company&apos;s
          accountant{d.tdsSource ? ` (${d.tdsSource})` : ""}. It is not computed
          by this system.
        </Text>

        <Text style={s.footer} fixed>
          {d.adjustmentFor
            ? `Computer-generated correction to the ${d.adjustmentFor.period} payslip · ${COMPANY_NAME} · does not require a signature`
            : `Computer-generated salary slip · ${COMPANY_NAME} · does not require a signature`}
        </Text>
      </Page>
    </Document>
  );
}

export function renderPayslip(d: PayslipData): Promise<Buffer> {
  return renderToBuffer(<Payslip d={d} />);
}

// ── Form 16 · Part B ───────────────────────────────────────────────────────

export interface Form16Data {
  employeeName: string;
  employeeCode: string;
  department: string;
  financialYear: string; // "2026-27"
  // FINALIZED rows only. An adjustment row carries a DELTA, so the totals below
  // remain correct as a plain sum.
  months: { month: string; gross: string; tds: string; isAdjustment?: boolean }[];
  totalGross: string;
  totalTds: string;
  totalPf: string;
  totalProfessionalTax: string;
  tdsSources: string[];
  monthsCovered: number; // DISTINCT months, so a corrected month counts once
  partial: boolean; // fewer than 12 finalized months
  generatedAt: Date;
}

function Form16({ d }: { d: Form16Data }) {
  const [startYear] = d.financialYear.split("-");
  return (
    <Document
      title={`Form 16 Part B ${d.employeeCode} FY${d.financialYear}`}
      author={COMPANY_NAME}
      subject={`Form 16 Part B for FY ${d.financialYear}`}
    >
      <Page size="A4" style={s.page}>
        <Text style={s.company}>{COMPANY_NAME}</Text>
        <Text style={s.docTitle}>
          FORM 16 · PART B · FINANCIAL YEAR {d.financialYear} (APR {startYear} – MAR{" "}
          {Number(startYear) + 1})
        </Text>
        <View style={s.rule} />

        <View style={s.metaGrid}>
          <Meta label="Employee" value={d.employeeName} />
          <Meta label="Employee code" value={d.employeeCode} />
          <Meta label="Department" value={d.department} />
          <Meta label="Financial year" value={d.financialYear} />
          <Meta label="Months included" value={`${d.monthsCovered} of 12`} />
          <Meta label="Generated on" value={d.generatedAt.toISOString().slice(0, 10)} />
        </View>

        {d.partial && (
          <View style={s.banner}>
            <Text>
              PARTIAL-YEAR STATEMENT — only {d.monthsCovered} of 12 months in FY{" "}
              {d.financialYear} have finalized payroll. The figures below cover
              those months only. Months with no finalized payroll are omitted
              entirely; nothing has been estimated or filled in.
            </Text>
          </View>
        )}

        <Text style={[s.colHead, { marginTop: 16, borderWidth: 1, borderColor: "#ddd" }]}>
          MONTH-WISE SUMMARY (FINALIZED PAYROLL ONLY)
        </Text>
        <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: "#ddd" }}>
          <View style={s.tHead}>
            <Text style={s.cMonth}>Month</Text>
            <Text style={s.cNum}>Gross Salary</Text>
            <Text style={s.cNum}>TDS Deducted</Text>
          </View>
          {d.months.map((m, i) => (
            <View style={s.tRow} key={`${m.month}-${i}`}>
              <Text style={s.cMonth}>
                {periodLabel(m.month)}
                {m.isAdjustment ? " — adjustment" : ""}
              </Text>
              <Text style={s.cNum}>{inr(m.gross)}</Text>
              <Text style={s.cNum}>{inr(m.tds)}</Text>
            </View>
          ))}
          {d.months.length === 0 && (
            <View style={s.tRow}>
              <Text style={s.cMonth}>No finalized payroll in this year</Text>
            </View>
          )}
        </View>

        <View style={[s.column, { marginTop: 16 }]}>
          <Text style={s.colHead}>SUMMARY</Text>
          <Line label="1. Gross salary (sum of finalized months)" value={d.totalGross} />
          <Line label="2. Provident Fund — employee contribution" value={d.totalPf} alt />
          <Line label="3. Professional Tax" value={d.totalProfessionalTax} />
          <View style={s.subtotal}>
            <Text>4. Total TDS deducted and deposited</Text>
            <Text>{inr(d.totalTds)}</Text>
          </View>
        </View>

        <Text style={s.note}>
          This statement aggregates figures already recorded against finalized
          payroll runs. Every TDS amount shown was entered by HR from the
          company&apos;s accountant
          {d.tdsSources.length > 0 ? ` (${d.tdsSources.join("; ")})` : ""}.
          {"\n"}
          No tax slab, exemption, rebate or deduction under Chapter VI-A has
          been computed by this system. Verify against Form 26AS / AIS before
          filing, and consult the company&apos;s accountant for the certified
          Part A and TRACES-generated document.
        </Text>

        <Text style={s.footer} fixed>
          Computer-generated statement · {COMPANY_NAME} · not a substitute for the
          TRACES-issued Form 16
        </Text>
      </Page>
    </Document>
  );
}

export function renderForm16(d: Form16Data): Promise<Buffer> {
  return renderToBuffer(<Form16 d={d} />);
}

// ── Offer Letter (Phase 8) ─────────────────────────────────────────────────
//
// Lives alongside the payslip and Form 16 templates so all three share the
// same StyleSheet, COMPANY_NAME and `inr` formatting — an offer letter that
// looked like a different company's document would be worse than no template.

export interface OfferLetterData {
  candidateName: string;
  designation: string;
  department: string;
  joiningDate: Date;
  basic: string;
  hra: string;
  specialAllowance: string;
  gross: string;
  annualGross: string;
  reportingTo: string | null;
  status: string; // APPROVED | SENT | ACCEPTED | DECLINED
  approvedAt: Date | null;
  generatedAt: Date;
}

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

function OfferLetter({ d }: { d: OfferLetterData }) {
  return (
    <Document
      title={`Offer Letter — ${d.candidateName}`}
      author={COMPANY_NAME}
      subject={`Offer of employment: ${d.designation}`}
    >
      <Page size="A4" style={s.page}>
        <Text style={s.company}>{COMPANY_NAME}</Text>
        <Text style={s.docTitle}>LETTER OF OFFER</Text>
        <View style={s.rule} />

        <View style={s.metaGrid}>
          <Meta label="Candidate" value={d.candidateName} />
          <Meta label="Date of issue" value={ymd(d.generatedAt)} />
          <Meta label="Designation" value={d.designation} />
          <Meta label="Department" value={d.department} />
          <Meta label="Joining date" value={ymd(d.joiningDate)} />
          <Meta label="Reporting to" value={d.reportingTo ?? "—"} />
        </View>

        <Text style={[s.note, { fontSize: 9.5, color: "#1a1a1a", marginBottom: 14 }]}>
          Dear {d.candidateName},{"\n"}
          {"\n"}
          We are pleased to offer you the position of{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.designation}</Text> in
          our {d.department} department, with effect from{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{ymd(d.joiningDate)}</Text>.
          Your compensation is set out below.
        </Text>

        <View style={s.column}>
          <Text style={s.colHead}>COMPENSATION — MONTHLY</Text>
          <Line label="Basic" value={d.basic} />
          <Line label="House Rent Allowance" value={d.hra} alt />
          <Line label="Special Allowance" value={d.specialAllowance} />
          <View style={s.subtotal}>
            <Text>Monthly Gross</Text>
            <Text>{inr(d.gross)}</Text>
          </View>
        </View>

        <View style={s.netBox}>
          <Text style={s.netLabel}>ANNUAL GROSS</Text>
          <Text style={s.netValue}>INR {inr(d.annualGross)}</Text>
        </View>

        <Text style={s.note}>
          The figures above are gross of statutory deductions. Provident Fund,
          ESI, Professional Tax and TDS will be deducted as applicable under
          Indian law and shown on each monthly payslip. TDS is determined by the
          company&apos;s accountant, not by this system.{"\n"}
          {"\n"}
          This offer is subject to satisfactory verification of the documents
          collected during onboarding. Please confirm your acceptance to the HR
          team.
        </Text>

        <View style={{ marginTop: 28, flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ width: "45%" }}>
            <View style={{ borderTopWidth: 1, borderTopColor: "#111", paddingTop: 5 }}>
              <Text style={{ fontSize: 8.5, color: "#555" }}>
                For {COMPANY_NAME} — authorised signatory
              </Text>
              {d.approvedAt && (
                <Text style={{ fontSize: 7.5, color: "#888", marginTop: 2 }}>
                  Approved internally on {ymd(d.approvedAt)}
                </Text>
              )}
            </View>
          </View>
          <View style={{ width: "45%" }}>
            <View style={{ borderTopWidth: 1, borderTopColor: "#111", paddingTop: 5 }}>
              <Text style={{ fontSize: 8.5, color: "#555" }}>
                Accepted by {d.candidateName}
              </Text>
              <Text style={{ fontSize: 7.5, color: "#888", marginTop: 2 }}>
                Signature and date
              </Text>
            </View>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {COMPANY_NAME} · offer status at time of generation: {d.status}
        </Text>
      </Page>
    </Document>
  );
}

export function renderOfferLetter(d: OfferLetterData): Promise<Buffer> {
  return renderToBuffer(<OfferLetter d={d} />);
}
