import { createClerkClient } from "@clerk/backend";
const c = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
(async () => {
  const list = await c.users.getUserList({ limit: 50 });
  console.log(`Clerk users: ${list.totalCount}`);
  for (const u of list.data) {
    const email = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress
      ?? u.emailAddresses[0]?.emailAddress ?? "(no email)";
    console.log(`  ${u.id}\n     email=${email}  role=${JSON.stringify(u.publicMetadata?.role ?? null)}  2FA=${u.twoFactorEnabled}  created=${new Date(u.createdAt).toISOString().slice(0,10)}`);
  }
})().catch((e) => { console.error("CLERK READ FAILED:", e.message); process.exit(1); });
