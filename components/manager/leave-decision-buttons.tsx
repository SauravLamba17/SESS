"use client";

import { DecisionButtons } from "@/components/ui/decision-buttons";

/** Phase 2 leave approvals. Behaviour unchanged — the shared implementation
 *  now lives in components/ui/decision-buttons.tsx. */
export function LeaveDecisionButtons({ id }: { id: string }) {
  return <DecisionButtons id={id} endpoint="/api/manager/leave" />;
}
