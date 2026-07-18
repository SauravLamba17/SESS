import { ModuleStub } from "@/components/portal/module-stub";

export default function AuditLog() {
  return (
    <ModuleStub
      title="Audit Log"
      description="Immutable record of privileged actions across the platform (actor, action, target entity, timestamp)."
      scope="Full audit (system-wide)"
    />
  );
}
