# The `build` step of family-calendar's zizd pipeline: bundles the Worker without deploying it and leaves everything the
# deploy step needs in /zazzle/output (the bundle, the static client, the migrations and wrangler.jsonc).
FROM node:22.21.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY run.sh /run.sh
CMD ["sh", "/run.sh"]
