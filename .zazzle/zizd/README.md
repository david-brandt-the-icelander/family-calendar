# `.zazzle/zizd/`: family-calendar's zizd pipeline

The steps zazzle's builders and deployers run for this repository, written against zazzle's step-pipeline spec
(`src/macos/zazzle-pipeline/pipeline-spec.md`, sections 1–4). One pipeline, `default`, so each step is a folder
`.zazzle/zizd/STEP/` with a `Dockerfile` and a `run.sh`. The pipeline file itself lives in the orchestrator
(`continuous_integration_and_delivery`, `.zazzle/zizd/pipelines/david-brandt-the-icelander/family-calendar/default.json`);
the copy below is what goes there.

| Step | Phase | Image | What it does | Leaves in `/zazzle/output` |
|---|---|---|---|---|
| `check` | build | `python:3.13.9-slim`, jsonschema 4.26.0 | validates the `.dev` diagrams and knowledge files (the CI `diagrams` job) | nothing |
| `test` | build | `mcr.microsoft.com/playwright:v1.65.0-noble` | `npm ci`, then `scripts/ci-test.sh`: unit tests, the vendored-library check, the API against `wrangler dev` with the z-faf stand-in, the client in Chromium (the CI `test` job) | nothing |
| `build` | build | `node:22.21.1-bookworm-slim`, wrangler 4.162.0 (`package-lock.json`) | `wrangler deploy --dry-run --outdir`: the bundled Worker | `dist/index.js`, `public/`, `migrations/`, `wrangler.jsonc`, `BUILD` (the commit) |
| `deploy` | deploy (`deploys: true`) | `node:22.21.1-bookworm-slim`, wrangler 4.162.0 | from `/zazzle/input/artifacts/build/` only: `wrangler d1 migrations apply family-calendar --remote`, then `wrangler deploy dist/index.js --no-bundle`. Never rebuilds. | nothing |

The deploy step:

- refuses without `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, without the build's artifacts, or with a
  placeholder D1 database id;
- applies the D1 migrations remotely before the deploy, as `README.md` ("Deploying") does by hand today;
- checks `ZAZZLE_HALT_FILE` before the migrations and before the deploy, and exits **75** when asked to halt;
- with `DEPLOY_DRY_RUN=1` (by hand only; no pipeline names it) needs no credentials, lists the migrations instead of
  applying them, and runs `wrangler deploy --dry-run` on the artifacts.

What the deploy does not do, as today: deploy z-friends-and-family first (its `FAF` binding must name a Worker that
exists), or change the login service's `APPS`. See `README.md`, "Deploy order".

## The pipeline file

```json
{
  "id": "david-brandt-the-icelander/family-calendar:default",
  "repos": ["https://github.com/david-brandt-the-icelander/family-calendar.git"],
  "paths": ["**", "!design/**", "!*.md"],
  "steps": [
    { "name": "check", "path": ".zazzle/zizd/check" },
    { "name": "test", "path": ".zazzle/zizd/test" },
    { "name": "build", "path": ".zazzle/zizd/build" },
    { "name": "deploy", "path": ".zazzle/zizd/deploy", "config": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"], "deploys": true }
  ],
  "supersede": true,
  "halt": { "deployment": "should" }
}
```

No `environments`: the calendar has one deployment, from `main`. A release branch, when there is one, becomes an
environment with its `branch`.

`paths` leaves out the mockups in `design/` and the Markdown at the root; every other change builds.

## Config keys

Names only; the values are in the orchestrator's config files (later zeecrets), never here.

| Key | Step | Where it goes |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `deploy` | `deploy_keys`; it must be able to deploy the Worker and its routes and apply D1 migrations |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy` | `deploy_keys` |

The build-phase steps need no key: the repository is public and `vendor/icelander-auth` is committed. The builder's
own `GITHUB_TOKEN` and z3 keys (`shared.json`) are zazzle's and reach no step.

## Trying it by hand

Each build-phase step was run with the spec's "Trying a step by hand" recipe, each step's output copied into the
next one's `/zazzle/input/artifacts/STEP/`, and the deploy step only without credentials (it refuses) and with
`DEPLOY_DRY_RUN=1`.

## What goes at cutover

Not yet removed: `.github/workflows/ci.yml` (its `diagrams` and `test` jobs are the `check` and `test` steps). There
is no legacy runner for this repository in `continuous_integration_and_delivery`.
