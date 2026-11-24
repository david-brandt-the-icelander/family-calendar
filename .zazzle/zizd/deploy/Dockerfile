# The `deploy` step of family-calendar's zizd pipeline (deploys: true): applies the D1 migrations and deploys the Worker
# the `build` step bundled, from /zazzle/input/artifacts/build. It never rebuilds. Needs CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID. wrangler is the version in package-lock.json.
FROM node:22.21.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
 && npm install -g --no-audit --no-fund wrangler@4.162.0 && npm cache clean --force
COPY run.sh /run.sh
CMD ["sh", "/run.sh"]
