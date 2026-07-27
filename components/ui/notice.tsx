import type { ReactNode } from "react";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";

/**
 * The two page-level notices every portal repeats.
 *
 * This exact Panel/StatusDot/span block was written out verbatim in ~60 places
 * across all four portals. The markup is genuinely identical everywhere — only
 * the message differs — so it is passed as children and nothing else about any
 * page changes. The surrounding role-specific content on each page is
 * untouched; only the duplicated wrapper moved here.
 */

/** A load failure. The message is the page's own sentence. */
export function ErrorPanel({ children }: { children: ReactNode }) {
  return (
    <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
      <StatusDot state="danger" />
      <span className="text-sm text-danger">{children}</span>
    </Panel>
  );
}

/**
 * A signed-in user with no Employee row yet — normal between account creation
 * and HR finishing onboarding, so it is a `warn`, not an error.
 *
 * Several pages add a sentence about what specifically will appear once the
 * record exists; pass children to override the default entirely.
 */
export function UnlinkedEmployeeNotice({ children }: { children?: ReactNode }) {
  return (
    <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
      <StatusDot state="warn" />
      <span className="text-sm text-text-muted">
        {children ?? "No employee record is linked to your account yet."}
      </span>
    </Panel>
  );
}
