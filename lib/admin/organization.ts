// Pure aggregation — no DB access, testable standalone (verify script).
// Departments remain STRING VALUES on Employee (no Department model): every
// consumer in the codebase (appraisal formulas, requisitions, offers, CSV
// import) already keys on the string, and this page only READS. A dedicated
// model earns its migration the day departments need owned attributes or
// rename/merge; flagged as future work, not built now.

export interface OrgEmployee {
  id: string;
  department: string;
  managerId: string | null;
  managerName: string | null;
}

export interface DepartmentSummary {
  department: string;
  headcount: number;
  /** Distinct names of managers overseeing employees IN this department. */
  managers: string[];
}

export function departmentSummary(employees: OrgEmployee[]): DepartmentSummary[] {
  const byDept = new Map<string, { headcount: number; managers: Set<string> }>();
  for (const e of employees) {
    const d = byDept.get(e.department) ?? { headcount: 0, managers: new Set<string>() };
    d.headcount++;
    if (e.managerName) d.managers.add(e.managerName);
    byDept.set(e.department, d);
  }
  return Array.from(byDept.entries())
    .map(([department, d]) => ({
      department,
      headcount: d.headcount,
      managers: Array.from(d.managers).sort(),
    }))
    .sort((a, b) => b.headcount - a.headcount || a.department.localeCompare(b.department));
}
