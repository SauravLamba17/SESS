import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import type { UpdateClerkRoleFn } from "@/lib/admin/user-role";

/**
 * The real Clerk Backend API call, isolated like lib/employees/invite-clerk.ts
 * so lib/admin/user-role.ts stays importable from plain-node verify scripts.
 * updateUserMetadata MERGES publicMetadata, so only `role` is touched.
 */
export const clerkUpdateUserRole: UpdateClerkRoleFn = async (clerkId, role) => {
  const client = await clerkClient();
  await client.users.updateUserMetadata(clerkId, { publicMetadata: { role } });
};
