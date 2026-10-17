// Read-only: row count per model + database / table sizes. TEST DB only.
import { Prisma } from "@prisma/client";
import { client } from "./ltdb.ts";

const db = client({ connectionLimit: 2 });
const counts: Record<string, number> = {};
let total = 0;
for (const m of Prisma.dmmf.datamodel.models) {
  const n = await (db as unknown as Record<string, { count: () => Promise<number> }>)[
    m.name[0].toLowerCase() + m.name.slice(1)
  ].count();
  counts[m.name] = n;
  total += n;
}
const [size] = await db.$queryRaw<{ size: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
const top = await db.$queryRaw<{ table: string; size: string }[]>`
  SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size
  FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 6`;
console.log(JSON.stringify({ counts, totalRows: total, databaseSize: size.size, largestTables: top }, null, 1));
await db.$disconnect();
