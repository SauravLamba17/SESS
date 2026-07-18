import { ModuleStub } from "@/components/portal/module-stub";

export default function ModuleToggles() {
  return (
    <ModuleStub
      title="Module Toggles"
      description="Enable or disable platform modules (attendance channels, idle tracking, client-mail AI, machine performance)."
      scope="Full configuration (system-wide)"
    />
  );
}
