import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import type { CreateInvitationFn } from "@/lib/employees/invite";

/**
 * The real Clerk Backend API call, kept in its own file so lib/employees/
 * invite.ts stays importable from plain-node verify scripts (importing
 * @clerk/nextjs/server outside Next.js crashes at module load).
 */
export const clerkCreateInvitation: CreateInvitationFn = async (params) => {
  const client = await clerkClient();
  return client.invitations.createInvitation(params);
};
