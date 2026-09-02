import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { appUrl } from "@/lib/app-url";
import type { CreateInvitationFn, FindClerkUserByEmailFn } from "@/lib/employees/invite";

/**
 * The real Clerk Backend API call, kept in its own file so lib/employees/
 * invite.ts stays importable from plain-node verify scripts (importing
 * @clerk/nextjs/server outside Next.js crashes at module load).
 *
 * ─── redirectUrl: WHERE THE ACCEPT LINK POINTS ───────────────────────────
 * Set here rather than in invite.ts on purpose. It is a Clerk TRANSPORT
 * concern, not invitation business logic, and this is the only file that
 * already depends on Clerk and on the Next runtime — so lib/app-url.ts can be
 * imported through the "@/" alias here, which plain Node could not resolve in
 * invite.ts.
 *
 * WHY IT IS NEEDED AT ALL: when redirectUrl is omitted, Clerk falls back to
 * the INSTANCE's own application URL configured in the Clerk dashboard. On a
 * development instance that default is localhost, which is how invitation
 * emails sent from a real deployment ended up carrying a localhost:3005 link
 * that gave every invited user ERR_CONNECTION_REFUSED. Nothing was hardcoded
 * in this repo — the URL was simply never specified, so Clerk supplied one.
 *
 * Passing it explicitly makes the destination a property of the running
 * deployment (see lib/app-url.ts for the resolution order), so it is right in
 * production and in local dev with no dashboard setting to remember.
 *
 * /sign-up because an invited person has no account yet: the link must land on
 * the page that renders Clerk's <SignUp>, which is what fires the user.created
 * webhook that linkClerkUserToEmployee() consumes to link them to their
 * Employee row.
 */
export const clerkCreateInvitation: CreateInvitationFn = async (params) => {
  const client = await clerkClient();
  return client.invitations.createInvitation({
    ...params,
    redirectUrl: appUrl("/sign-up"),
  });
};

/**
 * Does this address already own a Clerk account?
 *
 * Asked BEFORE every invitation (see lib/employees/invite.ts): an existing
 * account can never sign up again, so it can never fire user.created, so an
 * invitation sent to it could never be resolved into a User row.
 *
 * `emailAddress` is Clerk's own exact-match filter, not a fuzzy `query`, so
 * this cannot half-match a different person's address.
 */
export const clerkFindUserByEmail: FindClerkUserByEmailFn = async (email) => {
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ emailAddress: [email], limit: 1 });
  return data[0] ? { id: data[0].id } : null;
};
