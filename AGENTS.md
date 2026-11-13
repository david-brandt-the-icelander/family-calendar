# Agent instructions

The family calendar is one Cloudflare Worker (`src/`) with a D1 database (`migrations/`) and a static client (`public/`), served at **icelander.net/calendar**. Households, the people in them and their weekly schedules live here. Who a person is, and how they sign in, does not: that is icelander.net's login service (Google and the others), reached through the vendored `vendor/icelander-auth` and a service binding. Nothing in this repository talks to Google.

Run the tests with `scripts/ci-test.sh` (unit tests, the vendored-library check, a fresh local D1 and `wrangler dev` on :8801 with the library's stand-in sign-in, then the API in `test/itest.sh` and the client in a browser in `test/ui/`, Playwright; run `npx playwright install chromium` once). A change to `public/` needs a browser test that would fail without it: the API tests never draw a page.

## Rules

- **Never deploy, create the database, or run `wrangler` against anything remote** unless the owner asks. Setup is in `README.md`.
- **Every change reaches `main` through a pull request.** Work on a branch.
- **`vendor/icelander-auth/` is never edited here.** Change it in `icelander.net/packages/icelander-auth` and copy it with `sync.sh`; `test/vendored.mjs` fails if the copy differs from its stamp.
- **Everything a household can see hangs off `household_id`.** A query against people, schedules, rules or exceptions with no household above it in the join is a leak. `test/itest.sh` has a second household for no reason but to be invisible.
- **Light mode only, and no hidden information.** Everyone in a household sees everything in it. There is no "private" or "busy only" schedule, by the owner's decision.
- **`wrangler dev` needs `--local-upstream localhost:<port>`**: the route names icelander.net, and without it `request.url` does too, which makes the library refuse its stand-in sign-in.

## Architecture diagrams and knowledge files

Each folder documents itself in a `.dev/` directory next to its code, as JSON following the skills in `Meta/Agents/Skills/` and the knowledge catalogue in `Meta/Agents/Knowledge/` (human-assisted software development). Read a folder's `.dev` files before changing it. Diagrams: a component diagram for a cohesive folder, a deployment diagram for what deploys on its own (the repository root). Intent, constraints, decisions, backlog, configuration and the rest are knowledge files written with `describe-knowledge`. Wanted work is a `backlog` item, and a question only the owner can answer is a `decisions` record with `status: open`. Every actor a diagram names has a file in `Actors/`. Update the `.dev` files in the same commit as the code they describe, and before finishing run, from the repository root with the `jsonschema` package installed:

```bash
python3 Meta/Agents/Skills/validate_diagrams.py
python3 Meta/Agents/Knowledge/validate_knowledge.py
```

The skills and the catalogue come from <https://github.com/david-brandt-the-icelander/human-assisted-software-development> (`Agents/Skills` and `Agents/Knowledge`). Change them there and copy them here.
