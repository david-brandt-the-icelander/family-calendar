# Deploy family-calendar from the build step's artifacts: refuse without credentials or artifacts, check for a halt
# request before each sub-step (exit 75: a deployment that should or must halt stops between sub-steps, never in the
# middle of one), apply the D1 migrations remotely (README.md, "Deploying"), then deploy the bundled Worker as it is.
#
# DEPLOY_DRY_RUN=1, for trying the step by hand only (no pipeline names it): no credentials needed, no migrations
# applied (they are listed), and `wrangler deploy --dry-run` instead of the deploy.
set -eu
export HOME=/tmp npm_config_cache=/tmp/.npm CI=1 WRANGLER_SEND_METRICS=false
art=${ZAZZLE_ARTIFACTS:-/zazzle/input/artifacts}/build
dry=${DEPLOY_DRY_RUN:-}
halted() { if [ -n "${ZAZZLE_HALT_FILE:-}" ] && [ -f "$ZAZZLE_HALT_FILE" ]; then echo "halting before $1: $(cat "$ZAZZLE_HALT_FILE")"; exit 75; fi; }
if [ -z "$dry" ]; then
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || { echo "refusing: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed" >&2; exit 1; }
fi
for f in dist/index.js wrangler.jsonc migrations public; do
  [ -e "$art/$f" ] || { echo "refusing: the build step's artifacts have no $f ($art)" >&2; exit 1; }
done
rm -rf /tmp/deploy && cp -R "$art" /tmp/deploy
cd /tmp/deploy
grep -q '"database_id": "00000000-0000-0000-0000-000000000000"' wrangler.jsonc && { echo "refusing: wrangler.jsonc still has the placeholder D1 database id" >&2; exit 1; }
echo "deploying family-calendar $(cat BUILD 2>/dev/null || echo '?') with wrangler $(wrangler --version)"
halted "the migrations"
if [ -n "$dry" ]; then
  echo "dry run: would apply these migrations to family-calendar (remote):"; ls migrations
else
  wrangler d1 migrations apply family-calendar --remote -c wrangler.jsonc
fi
halted "the deploy"
if [ -n "$dry" ]; then
  wrangler deploy dist/index.js --no-bundle -c wrangler.jsonc --dry-run
else
  wrangler deploy dist/index.js --no-bundle -c wrangler.jsonc
fi
echo "family-calendar deployed${dry:+ (dry run)}"
