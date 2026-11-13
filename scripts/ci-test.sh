#!/usr/bin/env bash
# Everything the tests need, for CI and for a developer: unit tests, the vendored-library check, a fresh local
# D1, `wrangler dev` with the stand-in sign-in on :8801, then test/itest.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

node test/unit-expand.mjs
node test/vendored.mjs

rm -rf .wrangler/state
mkdir -p .wrangler
npx wrangler d1 migrations apply family-calendar --local >/dev/null
printf 'DEV_SIGN_IN="true"\n' > .dev.vars   # a --var would arrive as a boolean; the library wants the string
# The route names icelander.net, so without --local-upstream request.url says so and the stand-in sign-in refuses.
npx wrangler dev --local --port 8801 --local-upstream localhost:8801 > .wrangler/dev.log 2>&1 &
dev=$!
trap 'kill $dev 2>/dev/null || true' EXIT
for _ in $(seq 60); do curl -fsS -o /dev/null http://127.0.0.1:8801/calendar/health && break; kill -0 $dev 2>/dev/null || { cat .wrangler/dev.log; exit 1; }; sleep 1; done
curl -fsS -o /dev/null http://127.0.0.1:8801/calendar/health || { echo "wrangler dev never answered"; cat .wrangler/dev.log; exit 1; }
test/itest.sh
