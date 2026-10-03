// READ-ONLY: counts every model's rows + ZZ-/TEST- fixture leftovers. No writes.
// Usage: node --env-file=.env scratchpad/db-snapshot.cjs > out.json
const { PrismaClient, Prisma } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const out = {};
  for (const m of Prisma.dmmf.datamodel.models) {
    const key = m.name[0].toLowerCase() + m.name.slice(1);
    out[m.name] = await db[key].count();
  }
  out._leftoverEmployees = await db.employee.count({
    where: { OR: [{ employeeCode: { startsWith: "ZZ" } }, { employeeCode: { startsWith: "TEST-" } }] },
  });
  out._realEmployees = await db.employee.findMany({ orderBy: { employeeCode: "asc" } });
  out._killSwitch =await db.systemSetting.findUnique({ where: { key: "IDLE_TRACKING_ENABLED" } });
  console.log(JSON.stringify(out, null, 1));
  await db.$disconnect();
})();
