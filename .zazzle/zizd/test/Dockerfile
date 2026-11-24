# The `test` step of family-calendar's zizd pipeline: scripts/ci-test.sh (unit tests, the vendored-library check, the
# API against `wrangler dev` and the client in Chromium), as the `test` job of .github/workflows/ci.yml does. The
# Playwright image matches @playwright/test in package-lock.json, so its Chromium is the one the tests expect.
FROM mcr.microsoft.com/playwright:v1.65.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY run.sh /run.sh
CMD ["bash", "/run.sh"]
