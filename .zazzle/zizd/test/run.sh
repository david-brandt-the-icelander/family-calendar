# Copy the (read-only) repository, install exactly what package-lock.json says, and run every test. Writes nothing.
set -eu
export HOME=/tmp npm_config_cache=/tmp/.npm CI=1
src=$(ls -d /zazzle/input/repos/*/family-calendar | head -1)
cp -R "$src" /tmp/family-calendar
cd /tmp/family-calendar
npm ci --no-audit --no-fund
scripts/ci-test.sh
echo "family-calendar: tests passed"
