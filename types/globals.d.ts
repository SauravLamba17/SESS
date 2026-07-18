import type { Role } from "@/lib/auth-types";

// Augment Clerk's session-claims shape so `sessionClaims.metadata.role`
// is typed everywhere. Requires the Clerk session token to expose
// public metadata under the `metadata` claim (see README).
declare global {
  interface CustomJwtSessionClaims {
    metadata?: {
      role?: Role;
    };
  }
}

export {};
