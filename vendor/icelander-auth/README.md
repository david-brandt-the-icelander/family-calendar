# icelander-auth

The one sign-in for everything on icelander.net, on the app's side. The login service it talks to is `accounts/` in the icelander.net repository; the whole design is in that repository's `docs/accounts.md`.

| File | What it is |
| --- | --- |
| `index.js`, `index.d.ts` | The library: `createAuth`, `verifyToken`, and small helpers. No dependencies; runs in Workers and Node. |
| `client/play.js` | The games' browser script: the play-time heartbeat and the tip on a game-over screen. |
| `check.mjs`, `check.d.mts` | For a repository's tests: fails if the vendored copy was edited. |
| `sync.sh` | Copies the library into another repository (only in icelander.net). |
| `STAMP.json` | In a vendored copy only: the version and each file's SHA-256. |

## Using it in a Worker

```js
import { createAuth } from "../vendor/icelander-auth/index.js";

const auth = createAuth({ app: "games", cookie: "games_session" });

export default {
  async fetch(request, env) {
    const answered = await auth.handle(request, env); // /auth/sign-in, /auth/callback, /auth/sign-out, /auth/me, …
    if (answered) return answered;
    const { user, response } = await auth.requireRole(request, env, "games:recreations");
    if (response) return response; // a redirect to sign in, or 403
    // …
  },
};
```

The Worker needs, in its `wrangler.jsonc`:

```jsonc
"services": [{ "binding": "ACCOUNTS", "service": "accounts", "entrypoint": "Internal" }],
"vars": { "ACCOUNTS_JWKS": "<the login service's JWKS>" }
```

and its callback, `https://<host>[/<path>]/auth/callback`, registered in the login service's `APPS` (an app under a path sets `basePath`, `cookiePath` and `home`). Without either, nobody is signed in and `/auth/sign-in` answers 503 (fail closed). With `DEV_SIGN_IN` set to `"true"` on `localhost`, `/auth/dev?email=…&name=…&roles=…` signs in a stand-in user with no login service at all.

`currentUser(request, env)` asks the login service on every call, so a revoked role or a disabled user counts at once. It returns the roles of this app's prefixes only (the site's are `site:` and `games:`), and `via`, how the session was made: only `"provider"` carries more than the implicit roles.

## Limits, and the silent check (2.1.0)

- `auth.entitlements(request, env)` returns the person's rank and **this app's limits** (`limitOf(answer, "memesPerDay")`: 0 when closed, `Infinity` for no limit), and `approved(answer, "ai-images")` for the owner's separate approvals. It is kept in the isolate for the answer's `ttl` (60 seconds); pass `{ fresh: true }` before anything that costs money. With no answer (not signed in, the login service unreachable) nothing is granted.
- `GET /auth/probe?return=/…` is a silent "already signed in?" check: the visitor goes to the login service with `prompt=none` and comes straight back, signed in if they were, with no page shown. It asks at most once a day per browser (the cookie `<cookie>_probe`). For apps where signing in is optional; an app that requires it just redirects to `/auth/sign-in`.

## Vendoring

The repositories are separate, so each holds a copy in `vendor/icelander-auth/`. Change the library only here, bump `VERSION` in `index.js`, then copy it:

```bash
packages/icelander-auth/sync.sh ../recreations/vendor/icelander-auth
```

Each repository has a test that calls `checkVendored()`, which fails if its copy no longer matches its `STAMP.json`.
