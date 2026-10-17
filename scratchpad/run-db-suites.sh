#!/usr/bin/env bash
# Runs every DB-touching verify suite against the TEST project only, through
# scripts/loadtest/lt-run.mjs (env from .env.loadtest; cwd = the lt-app copy,
# which has no .env files). Direct DB access uses the session pooler (--session).
# The app server on :3005 is lt-app's production build, also on the test DB.
cd "C:/Users/Saurav/Desktop/WORK/SESS" || exit 1
export LT_APP_DIR="C:/Users/Saurav/AppData/Local/Temp/claude/C--Users-Saurav-Desktop-WORK-SESS/54998fcb-5905-4bea-bc0e-cb54dfa13ee9/scratchpad/lt-app"
OUT="C:/Users/Saurav/AppData/Local/Temp/claude/C--Users-Saurav-Desktop-WORK-SESS/54998fcb-5905-4bea-bc0e-cb54dfa13ee9/scratchpad/suites-db"
mkdir -p "$OUT"
run() { # name, command...
  local n=$1; shift
  timeout 1800 node scripts/loadtest/lt-run.mjs --session -- "$@" > "$OUT/$n.log" 2>&1
  echo "$n exit=$? | $(grep -aE 'RESULT|passed|PASSED|failed' "$OUT/$n.log" | tail -1 | cut -c1-150)" >> "$OUT/summary.txt"
}
: > "$OUT/summary.txt"
for s in ats-enhancements ats-retention clerk-invite-link engagement idle-tracking manager-punch night-shift \
         payroll-adjustment payroll-workflow phase10 phase12 phase12b phase13 punch-location \
         recruitment-pipeline report-freshness report-preview self-healing-identity super-admin-identity terms-acceptance; do
  run "$s" node "prisma/verify-$s.ts"
done
for s in audit-fixes demo-mode redaction-robustness; do run "$s" npx tsx "prisma/verify-$s.ts"; done
run phase11 node --import ./scripts/alias-loader.mjs prisma/verify-phase11.ts
run caching node --import ./scripts/alias-loader.mjs ./scripts/caching.selfcheck.ts
run rate-limit-exhaust npx tsx prisma/verify-rate-limit.ts exhaust
echo "RESTART_SERVER_NOW" >> "$OUT/summary.txt"
