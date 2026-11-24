# Bundle the Worker with the repository's own wrangler (package-lock.json) and lay out what `deploy` deploys:
#   dist/index.js      the bundled Worker (wrangler deploy --dry-run --outdir)
#   public/            the static client, served as the Worker's assets
#   migrations/        the D1 migrations
#   wrangler.jsonc     the repository's config; `deploy` names dist/index.js as the script, so main is not used
#   BUILD              the commit
set -eu
export HOME=/tmp npm_config_cache=/tmp/.npm CI=1 WRANGLER_SEND_METRICS=false
out=${ZAZZLE_OUTPUT:-/zazzle/output}
src=$(ls -d /zazzle/input/repos/*/family-calendar | head -1)
cp -R "$src" /tmp/family-calendar
cd /tmp/family-calendar
npm ci --no-audit --no-fund
node test/vendored.mjs
npx wrangler --version
npx wrangler deploy --dry-run -c wrangler.jsonc --outdir "$out/dist"
cp -R public migrations wrangler.jsonc "$out/"
git rev-parse HEAD > "$out/BUILD"
ls -R "$out"
echo "family-calendar built"
