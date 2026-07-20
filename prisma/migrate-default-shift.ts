/**
 * One-time migration (Phase 6 — Shift Scheduling backward-compat).
 *
 * Creates the "Standard" Shift and assigns EVERY existing Employee that has no
 * shift yet to it — so no existing employee's lateFlag semantics change unless
 * someone later reassigns them. Idempotent (upsert by name; only fills null
 * shiftId), safe to re-run. Run after `prisma db push`.
 *
 * NOTE: the live WORKDAY_START was empty, so startTime falls back to the
 * codebase's documented default "09:30" (endTime = +8h). Change it later via
 * the HR → Shifts page if a different standard start is wanted.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function plus8h(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return "17:30";
  const total = (Number(m[1]) * 60 + Number(m[2]) + 8 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const min = total % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

async function main() {
  const raw = (process.env.WORKDAY_START ?? "").trim();
  const startTime = /^(\d{1,2}):(\d{2})$/.test(raw) ? raw : "09:30";
  const endTime = plus8h(startTime);

  const standard = await db.shift.upsert({
    where: { name: "Standard" },
    update: {}, // don't clobber if it already exists
    create: {
      name: "Standard",
      startTime,
      endTime,
      gracePeriodMinutes: 0,
      createdBy: "system-migration",
    },
  });
  console.log(
    `Standard shift: id=${standard.id} start=${standard.startTime} end=${standard.endTime} grace=${standard.gracePeriodMinutes}`,
  );

  const totalBefore = await db.employee.count();
  const nullBefore = await db.employee.count({ where: { shiftId: null } });
  const res = await db.employee.updateMany({
    where: { shiftId: null },
    data: { shiftId: standard.id },
  });
  const nullAfter = await db.employee.count({ where: { shiftId: null } });

  console.log(`Total employees: ${totalBefore}`);
  console.log(`Had no shift before: ${nullBefore}`);
  console.log(`Migrated (assigned Standard): ${res.count}`);
  console.log(`Still without a shift after: ${nullAfter}  (must be 0)`);
  if (nullAfter !== 0) throw new Error("Some employees were skipped!");
  console.log("OK — no employee skipped.");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("MIGRATION FAILED:", e);
    await db.$disconnect();
    process.exit(1);
  });
