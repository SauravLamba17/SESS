# SESS — Simplen Employee Self-Service

A production / quality / attendance / payroll HRMS. Competitor-grade
alternative to Keka HR, with differentiators Keka doesn't have:

- **System idle-time tracking** (active vs idle minutes, consent-gated)
- **Quality-linked production appraisal formula** (Super-Admin-owned weights)
- **Shift-aware attendance** including an overnight shift that spans midnight
- **Versioned salary structures** with an immutable finalized-payroll trail

### Cut from scope

Two features were removed during development and are **not** part of this
system. They are listed here because earlier drafts of this README advertised
them, and the schema still carries removal notes where their tables used to be:

- **Face-verification / camera punch** — cut in Phase 11. `ConsentRecord`
  now only ever holds `IDLE_TRACKING`.
- **Per-machine performance averages** — cut in Phase 13 with the `MachineLog`
  table. `Employee.machineId` survives only as a free-text workstation label.

One app, one database, four role-scoped portals:
`/employee`, `/manager`, `/hr`, `/admin`.

## Tech stack

- Next.js 14 (App Router, TypeScript) — runs on **port 3005**
- Tailwind CSS (instrument-panel design tokens)
- Clerk (`@clerk/nextjs` v6) for auth + roles
- Supabase PostgreSQL + Prisma ORM

## Roles

Strict hierarchy: **SUPER_ADMIN > HR > MANAGER > EMPLOYEE**.

| Route group   | Allowed roles                      |
| ------------- | ---------------------------------- |
| `/employee/*` | Employee, Manager, HR, Super Admin |
| `/manager/*`  | Manager, HR, Super Admin           |
| `/hr/*`       | HR, Super Admin                    |
| `/admin/*`    | Super Admin only                   |

A Manager only ever sees their **direct reports** (single level). This is
enforced in the data layer (`lib/data/scope.ts`) via
`WHERE managerId = <manager's employeeId>`, not just hidden in the UI.
Route access is enforced in `middleware.ts`.

## Prerequisites

- Node.js 18.18+ (tested on Node 24)
- A **new** Clerk application (not shared with any other app)
- A **new** Supabase PostgreSQL project (not shared with any other app)

## Setup & run

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    then fill in real values (see "Environment" below)

# 3. Push the Prisma schema to your Supabase database
npx prisma db push

# 4. Generate the Prisma client
npx prisma generate

# 5. Start the dev server (http://localhost:3005)
npm run dev
```

Production build:

```bash
npm run build
npm run start   # also serves on port 3005
```

## Environment

Copy `.env.example` → `.env` and set the values below. `.env.example` carries
the full reasoning for each one (especially the `DATABASE_URL` port choice);
this table is the index.

**Required**

| Variable                            | Where to get it                                          |
| ----------------------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard → API Keys                               |
| `CLERK_SECRET_KEY`                  | Clerk Dashboard → API Keys                               |
| `CLERK_WEBHOOK_SECRET`              | Clerk Dashboard → Webhooks → Add Endpoint (`whsec_…`). Needed for the invitation → account-link flow |
| `DATABASE_URL`                      | Supabase → Project Settings → Database → Connection URI. Use a **pooler** host, not the direct one — port 5432 locally, 6543 + `pgbouncer=true` on Vercel |

**Optional — defaults work without them**

| Variable                       | Default        | What it does                                                                 |
| ------------------------------ | -------------- | ---------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`          | auto-detected  | Forces the base URL for links that leave the app (invitation emails). Leave unset on Vercel — see `lib/app-url.ts` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`| `/sign-in`     | Clerk redirect override                                                       |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`| `/sign-up`     | Clerk redirect override                                                       |
| `IDLE_THRESHOLD_SECONDS`       | `210`          | Deploy-time default for the idle agent. A Super Admin can override it at runtime; the database value wins |
| `DEMO_MODE`                    | unset (off)    | `true` enables Super Admin impersonation. Must stay unset in production      |

**Attendance punch validation — placeholders, set before relying on them**

| Variable                       | Default | What it does                                                       |
| ------------------------------ | ------- | ------------------------------------------------------------------ |
| `ATTENDANCE_VALIDATION_MODE`   | `NONE`  | `NONE` \| `IP_LOCK` \| `GEOFENCE` \| `BOTH`                        |
| `ALLOWED_IPS`                  | empty   | Comma-separated office egress IPs (`IP_LOCK` / `BOTH`)             |
| `OFFICE_LAT`, `OFFICE_LONG`    | empty   | Office coordinates (`GEOFENCE` / `BOTH`)                           |
| `GEOFENCE_RADIUS_METERS`       | empty   | Geofence radius in metres                                          |
| `WORKDAY_START`                | empty   | `HH:MM` fallback lateness cutoff, used **only** for an employee with no assigned Shift |

`VERCEL_PROJECT_PRODUCTION_URL` and `VERCEL_URL` are injected by Vercel — do
not set them yourself.

## Clerk role configuration (required)

Roles are stored in each Clerk user's **`publicMetadata.role`**, one of:
`EMPLOYEE | MANAGER | HR | SUPER_ADMIN`.

**1. Assign a role to a user.** In the Clerk Dashboard → Users → (select
user) → Metadata → **Public**, add:

```json
{ "role": "SUPER_ADMIN" }
```

**2. Expose the role in the session token** so middleware (edge) can read it
without an API call. In Clerk Dashboard → **Sessions → Customize session
token**, set the claims to:

```json
{ "metadata": "{{user.public_metadata}}" }
```

The app reads the role from `sessionClaims.metadata.role` in
`middleware.ts` and `lib/auth.ts`. `lib/auth.ts` falls back to fetching the
full user if the token claim isn't present yet.

Without step 2, portal routes will redirect to `/` because the role can't be
seen in the token.

## Project structure

```
app/
  layout.tsx              ClerkProvider + fonts (Space Grotesk / Inter / IBM Plex Mono)
  page.tsx                Landing; redirects signed-in users to their portal
  sign-in / sign-up       Clerk catch-all auth pages
  employee/ manager/ hr/ admin/
                          Route groups; each layout wraps children in <PortalShell>
components/
  brand/logo.tsx          Gauge/dial mark + wordmark
  ui/status-dot.tsx       Signature 7px glowing status dot (good/warn/danger/idle)
  ui/panel.tsx            Panel + StatCard
  portal/                 Sidebar, PortalShell, PageHeader
lib/
  auth-types.ts           Client-safe: Role type, label/route maps, nav, permission scoping
  auth.ts                 Server-only: getCurrentRole() via Clerk auth()
  db.ts                   Prisma client singleton
  data/scope.ts           Query-level manager -> direct-reports scoping
middleware.ts             Clerk middleware; role-gates the four route groups
prisma/schema.prisma      Full data model
types/globals.d.ts        Clerk session-claims type augmentation
```

> **Client/server split:** `lib/auth-types.ts` has **no** server-only imports,
> so client components (e.g. the sidebar) can import the `Role` type and maps
> without pulling Clerk's server `auth()` / `next/headers` into the client
> bundle. `lib/auth.ts` is the server-only counterpart.

## Design system

Instrument-panel aesthetic (precision, not generic SaaS):

- Graphite base `#0F1417`, surfaces `#171D21` / `#1E262B`, border `#2A333A`
- Text `#E8ECEE` / muted `#8B98A1`; amber accent `#F5A623` (used sparingly)
- Semantic: good `#2BB673`, danger `#E5484D`, info `#4C9FE8`
- Fonts: Space Grotesk (headings), Inter (body), IBM Plex Mono (every
  employee code, machine ID and data value — a deliberate signature)
- 4px border radius everywhere
- **Signature motif:** the `<StatusDot />` — used next to every status label
  across all four portals to tie the product together.

## Verify (acceptance criteria)

```bash
npx tsc --noEmit     # zero type errors
npx prisma generate  # schema generates cleanly
npm run build        # succeeds with real env vars present
```
