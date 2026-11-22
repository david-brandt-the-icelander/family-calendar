// icelander-auth: the one sign-in for every project on icelander.net (icelander.net docs/accounts.md).
//
// This file is the whole client library. It is vendored, byte for byte, into every repository that
// signs people in (see README.md, "Vendoring"); change it here, bump VERSION, and copy it with sync.sh.
//
// An app is a host (or a path of one) with a host-only cookie of its own; today only the site, the games included. The library:
//   GET  /auth/sign-in?return=/…  sends the visitor to icelander.net/accounts, with a fresh `state`
//   GET  /auth/callback           back from it: checks the token, redeems it once, sets the app's cookie
//   POST /auth/sign-out           ends this app's session (same-origin only)
//   POST /auth/sign-out-everywhere ends every session of the user, on every app (same-origin only)
//   GET  /auth/me                 { user, signInUrl }
//   GET  /auth/dev?email=…        the stand-in sign-in: only with DEV_SIGN_IN "true" on a local host
// and, for every other request, currentUser() and requireRole().
//
// Everything the app needs from the login service goes through env.ACCOUNTS, a service binding to its
// `Internal` entrypoint, which the internet can't reach. Tokens are also checked here against the
// pinned public keys in env.ACCOUNTS_JWKS. Without either, sign-in is off and nobody is signed in
// (fail closed). Tokens, cookies and session values are never logged.

export const VERSION = "2.2.0";
/** The login service: icelander.net/accounts (a Worker of its own on that path). */
export const ISSUER = "https://icelander.net/accounts";
/** How long an app's sign-in lasts, unless the user signs out or is signed out. */
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const STATE_SECONDS = 10 * 60;
const PROBE_SECONDS = 24 * 60 * 60;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const encoder = new TextEncoder();

// --- Encoding -------------------------------------------------------------------------------------

export function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(text) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
}

// --- Tokens ---------------------------------------------------------------------------------------

/** The public keys, from a JWKS as JSON text or an object: { keys: [{ kty: "OKP", crv: "Ed25519", kid, x }] }. */
export function parseJwks(jwks) {
  try {
    const set = typeof jwks === "string" ? JSON.parse(jwks) : jwks;
    const keys = Array.isArray(set?.keys) ? set.keys : [];
    return keys.filter((k) => k && k.kty === "OKP" && k.crv === "Ed25519" && typeof k.kid === "string" && typeof k.x === "string");
  } catch {
    return [];
  }
}

const importPublic = (jwk) =>
  crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);

/**
 * The claims of a sign-in token, or undefined. Checks, in order: the form (three base64url parts, one
 * spelling each), the header (EdDSA, a known kid), the Ed25519 signature, then iss, aud, exp (and that
 * the token was never meant to live more than 60 s), iat, sub, jti and, when given, nonce.
 */
export async function verifyToken(token, { jwks, audience, nonce, now = Date.now() / 1000, issuer = ISSUER } = {}) {
  if (typeof token !== "string" || token.length > 4096) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const [h, p, s] = parts;
    for (const part of parts) if (base64url(fromBase64url(part)) !== part) return undefined;
    const header = JSON.parse(new TextDecoder().decode(fromBase64url(h)));
    if (header?.alg !== "EdDSA" || typeof header.kid !== "string") return undefined;
    const jwk = parseJwks(jwks).find((k) => k.kid === header.kid);
    if (!jwk) return undefined;
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, await importPublic(jwk), fromBase64url(s), encoder.encode(`${h}.${p}`));
    if (!ok) return undefined;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(p)));
    if (!claims || claims.iss !== issuer) return undefined;
    if (typeof audience !== "string" || claims.aud !== audience) return undefined;
    if (typeof claims.exp !== "number" || typeof claims.iat !== "number") return undefined;
    if (claims.exp <= now || claims.exp - claims.iat > 60 || claims.iat > now + 30) return undefined;
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.jti !== "string" || claims.jti.length < 16) return undefined;
    if (nonce !== undefined && claims.nonce !== nonce) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

/** The generic roles a person may hold in a tenant, least to most (docs/tenants.md); apps map them to their own permissions. */
export const TENANT_ROLES = ["guest", "member", "admin", "owner"];
const TENANT_ID = /^t-[a-z0-9][a-z0-9-]{1,38}$/;
/** The person's role in this tenant, from the user the login service reported (an app that opted in), or undefined. */
export const tenantRole = (user, tenantId) => user?.tenants?.find((t) => t.id === tenantId)?.role;
/** Whether the person holds at least this role in the tenant. */
export const tenantAtLeast = (user, tenantId, role) => {
  const have = TENANT_ROLES.indexOf(tenantRole(user, tenantId));
  return have >= 0 && have >= TENANT_ROLES.indexOf(role);
};

/** Where the identity app issues access tokens (its OAuth issuer). */
export const OAUTH_ISSUER = "https://icelander.net/apps/identity";

/**
 * The claims of an access token for an MCP server, or undefined: EdDSA, header typ "at+jwt" (a sign-in token is
 * "JWT" and can never pass here, nor this one there), signed by a pinned key, issued by the identity app, for
 * this resource, unexpired and never meant to live more than 15 minutes, with a subject and a scope.
 */
export async function verifyAccessToken(token, { jwks, resource, now = Date.now() / 1000, issuer = OAUTH_ISSUER } = {}) {
  if (typeof token !== "string" || token.length > 4096) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const [h, p, s] = parts;
    for (const part of parts) if (base64url(fromBase64url(part)) !== part) return undefined;
    const header = JSON.parse(new TextDecoder().decode(fromBase64url(h)));
    if (header?.alg !== "EdDSA" || header.typ !== "at+jwt" || typeof header.kid !== "string") return undefined;
    const jwk = parseJwks(jwks).find((k) => k.kid === header.kid);
    if (!jwk) return undefined;
    if (!(await crypto.subtle.verify({ name: "Ed25519" }, await importPublic(jwk), fromBase64url(s), encoder.encode(`${h}.${p}`)))) return undefined;
    const c = JSON.parse(new TextDecoder().decode(fromBase64url(p)));
    if (!c || c.iss !== issuer || typeof resource !== "string" || c.aud !== resource) return undefined;
    if (typeof c.exp !== "number" || typeof c.iat !== "number" || c.exp <= now || c.exp - c.iat > 900 || c.iat > now + 30) return undefined;
    if (typeof c.sub !== "string" || !c.sub || typeof c.scope !== "string" || typeof c.gid !== "string") return undefined;
    // The tenant the token acts in, when it names one (docs/tenants.md): a malformed one voids the token.
    if (c.tid !== undefined && !TENANT_ID.test(String(c.tid))) return undefined;
    return c;
  } catch {
    return undefined;
  }
}

// --- Requests -------------------------------------------------------------------------------------

export function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** A Set-Cookie value: host-only (no Domain), HttpOnly, Secure, SameSite=Lax. */
export function cookie(name, value, seconds, { path = "/", secure = true } = {}) {
  return `${name}=${value}; Path=${path}; Max-Age=${seconds}; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}

export const isLocal = (url) => LOCAL_HOSTS.has(url.hostname);

/**
 * Whether a POST came from a page of this very origin. A browser sends Origin on every POST; a request
 * without it is accepted only when Sec-Fetch-Site says same-origin. Anything else is refused (CSRF).
 */
export function sameOrigin(request, url = new URL(request.url)) {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === url.origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** A path on this host to come back to, or `fallback`: never absolute, protocol-relative or odd. */
export function safeReturn(value, fallback = "/", basePath = "/auth") {
  if (typeof value !== "string" || value.length > 500) return fallback;
  if (!/^\/(?![/\\])[\x21-\x7e]*$/.test(value) || value.includes("\\") || /%2f|%5c/i.test(value.slice(0, 3))) return fallback;
  if (value === basePath || value.startsWith(`${basePath}/`) || value.startsWith(`${basePath}?`)) return fallback;
  return value;
}

const noStore = { "cache-control": "no-store" };

function redirect(location, cookies = [], status = 302) {
  const headers = new Headers({ location, ...noStore, "referrer-policy": "no-referrer" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status, headers });
}

const json = (body, status = 200, cookies = []) => {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", vary: "Cookie" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
};

const text = (body, status) => new Response(body + "\n", { status, headers: { "content-type": "text/plain; charset=utf-8", ...noStore } });

/** One limit of an entitlements answer: 0 when there is no answer or no such limit (closed), Infinity for no limit. */
export function limitOf(answer, key) {
  const v = answer?.limits?.[key];
  return v === undefined ? 0 : v === null ? Infinity : v;
}

/** Whether the owner has approved this capability (AI images, write keys) for the person. */
export const approved = (answer, capability) => Boolean(answer?.approvals?.includes(capability));

// --- The app's side -------------------------------------------------------------------------------

/**
 * The sign-in for one app.
 *   app            the app id registered with the login service ("site")
 *   cookie         the app's own cookie name, e.g. "games_session"
 *   basePath       where the routes above live (default "/auth")
 *   cookiePath     the Path of the app's cookie (default "/"; an app under a path, e.g. "/other")
 *   home           where to go when `return` is missing or unsafe (default "/")
 *   accountsOrigin the login service's address (default https://icelander.net/accounts)
 *   bearer         also accept "Authorization: Bearer <session>" (a desktop build talking to a dev server)
 *   binding        the name of the service binding to the login service (default "ACCOUNTS"; an app whose
 *                  ACCOUNTS is something else names it otherwise, e.g. "LOGIN")
 */
export function createAuth(options) {
  const app = options.app;
  const name = options.cookie;
  const basePath = options.basePath ?? "/auth";
  const home = options.home ?? "/";
  const accountsOrigin = (options.accountsOrigin ?? ISSUER).replace(/\/+$/, "");
  const cookiePath = options.cookiePath ?? "/";
  const stateCookie = `${name}_state`;
  const probeCookie = `${name}_probe`;
  const bindingName = options.binding ?? "ACCOUNTS";
  const service = (env) => env?.[bindingName];
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(app ?? "") || !/^[a-z][a-z0-9_]{0,40}$/.test(name ?? "")) throw new Error("icelander-auth: bad app or cookie name");

  const configured = (env) => Boolean(service(env) && parseJwks(env.ACCOUNTS_JWKS).length);
  const devOn = (env, url) => env?.DEV_SIGN_IN === "true" && isLocal(url);
  const back = (value) => safeReturn(value, home, basePath);

  function sessionValue(request) {
    const fromCookie = readCookie(request, name);
    if (fromCookie) return fromCookie;
    if (!options.bearer) return undefined;
    return (request.headers.get("authorization") ?? "").match(/^Bearer ([A-Za-z0-9_.-]{20,2000})$/)?.[1];
  }

  /** The stand-in's tenants: "t-id:role[:handle]" each, like the login service reports them (docs/tenants.md). */
  function devTenants(list) {
    const tenants = (Array.isArray(list) ? list : []).map((t) => String(t).split(":")).filter(([id, role]) => TENANT_ID.test(id) && TENANT_ROLES.includes(role))
      .map(([id, role, handle]) => ({ id, name: id, role, ...(handle ? { handle } : {}) }));
    return { tenants, tenant: tenants.length === 1 ? tenants[0] : null };
  }

  /** The stand-in sign-in's session: "dev." and base64url JSON of the user. Only ever read on a local host with DEV_SIGN_IN. */
  function devUser(value) {
    try {
      const u = JSON.parse(new TextDecoder().decode(fromBase64url(value.slice(4))));
      const email = String(u.email ?? "").toLowerCase();
      const prefixes = [app, ...(options.rolePrefixes ?? [])];
      const roles = (Array.isArray(u.roles) ? u.roles : []).filter((r) => typeof r === "string" && prefixes.some((p) => r.startsWith(`${p}:`)));
      return {
        id: String(u.id ?? `dev-${email}`), email, emails: [email], name: String(u.name ?? "Tester"), picture: null,
        // The implicit roles every signed-in user holds: this app's, and "play" for each other prefix it carries (games:play).
        roles: [`${app}:${options.implicitRole ?? "play"}`, ...(options.rolePrefixes ?? []).map((p) => `${p}:play`), ...roles].filter((r, i, all) => all.indexOf(r) === i),
        supporter: false, accountIds: {}, dev: true,
        via: u.via === "email" || u.via === "link" ? u.via : "provider",
        ...devTenants(u.tenants),
      };
    } catch {
      return null;
    }
  }

  /** The signed-in user ({ id, email, emails, name, picture, roles, supporter, accountIds }), or null. Checked live on every call. */
  async function currentUser(request, env) {
    const value = sessionValue(request);
    if (!value) return null;
    const url = new URL(request.url);
    if (value.startsWith("dev.")) return devOn(env, url) ? devUser(value) : null;
    if (!configured(env) || value.length > 200) return null;
    try {
      return (await service(env).session(value, app)) ?? null;
    } catch {
      return null; // the login service is unreachable: nobody is signed in, rather than anyone
    }
  }

  const cache = new Map();
  /**
   * What this person may use in this app (docs/identity-app-plan.md, 5.3): { rank, limits, approvals, v, ttl, … }, or
   * null. Asked of the login service, then kept in this isolate for the answer's own ttl (60 seconds), so revoking
   * something takes at most that long to reach an app that asks only once a minute; pass { fresh: true } before
   * anything that costs money.
   */
  async function entitlements(request, env, { fresh = false } = {}) {
    const value = sessionValue(request);
    if (!value || value.startsWith("dev.") || !configured(env)) return null;
    const hit = cache.get(value);
    if (!fresh && hit && hit.until > Date.now()) return hit.answer;
    try {
      const answer = (await service(env).entitlements(value, app)) ?? null;
      if (answer) cache.set(value, { answer, until: Date.now() + Math.max(0, Number(answer.ttl) || 0) * 1000 });
      else cache.delete(value);
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return answer;
    } catch {
      return null; // unreachable: no limits are granted, never unlimited ones
    }
  }

  const hasRole = (user, role) => Boolean(user?.roles?.includes(role));

  const signInPath = (returnTo) => `${basePath}/sign-in?return=${encodeURIComponent(back(returnTo))}`;

  /**
   * The user if they hold `role`; otherwise a Response: a redirect to sign in (for a page, when signed out),
   * 401 (an API, signed out) or 403 (signed in without the role).
   */
  async function requireRole(request, env, role, { api = false } = {}) {
    const user = await currentUser(request, env);
    if (user && hasRole(user, role)) return { user };
    if (!user) {
      const url = new URL(request.url);
      if (api || (request.method !== "GET" && request.method !== "HEAD")) return { response: json({ code: "unauthorized", message: "sign in first" }, 401) };
      return { response: redirect(signInPath(url.pathname + url.search)) };
    }
    return { user, response: api ? json({ code: "forbidden", message: "not allowed" }, 403) : text("Not allowed.", 403) };
  }

  /** Answers the routes under basePath, or undefined for any other path. */
  async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    if (path !== basePath && !path.startsWith(`${basePath}/`)) return undefined;
    const route = path.slice(basePath.length);
    const method = request.method;
    // Secure even on a local host: browsers treat localhost as a secure context.
    const secure = true;

    if (route === "/me" && (method === "GET" || method === "HEAD")) {
      const user = await currentUser(request, env);
      return json({ user, signInUrl: signInPath(url.searchParams.get("return") ?? home) });
    }

    if (route === "/dev" && method === "GET") {
      if (!devOn(env, url)) return text("Not found.", 404);
      const email = (url.searchParams.get("email") || "tester@example.com").toLowerCase().slice(0, 254);
      const roles = (url.searchParams.get("roles") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
      const tenants = (url.searchParams.get("tenants") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      const body = { id: url.searchParams.get("id") || `dev-${email}`, email, name: (url.searchParams.get("name") || "Tester").slice(0, 80), roles, via: url.searchParams.get("via") ?? "provider", ...(tenants.length ? { tenants } : {}) };
      const value = `dev.${base64url(encoder.encode(JSON.stringify(body)))}`;
      if (url.searchParams.get("format") === "token") return json({ token: value });
      return redirect(back(url.searchParams.get("return")), [cookie(name, value, SESSION_SECONDS, { secure, path: cookiePath })]);
    }

    if (route === "/sign-out" || route === "/sign-out-everywhere") {
      if (method !== "POST") return text("Use POST.", 405);
      if (!sameOrigin(request, url)) return json({ code: "forbidden", message: "origin not allowed" }, 403);
      const value = sessionValue(request);
      if (value && !value.startsWith("dev.") && configured(env)) {
        try {
          if (route === "/sign-out") await service(env).signOut(value, app);
          else await service(env).signOutEverywhere(value, app);
        } catch {
          // The cookie is cleared below either way.
        }
      }
      const cleared = [cookie(name, "", 0, { secure, path: cookiePath })];
      if ((request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) {
        const form = await request.formData().catch(() => undefined);
        return redirect(back(form?.get("return")), cleared, 303);
      }
      return json({ ok: true }, 200, cleared);
    }

    if (route === "/sign-in" && (method === "GET" || method === "HEAD")) {
      if (!configured(env)) {
        if (devOn(env, url)) return redirect(`${basePath}/dev?return=${encodeURIComponent(back(url.searchParams.get("return")))}`);
        return text("Sign-in is not available here.", 503);
      }
      const state = randomToken();
      const to = new URL(`${accountsOrigin}/sign-in`);
      to.search = new URLSearchParams({ app, return: back(url.searchParams.get("return")), state, callback: `${url.origin}${basePath}/callback` }).toString();
      if (url.searchParams.get("prompt") === "select") to.searchParams.set("prompt", "select");
      // The tenant to act in (docs/tenants.md); the login service puts it in the token only if the person is a member.
      if (TENANT_ID.test(url.searchParams.get("tenant") ?? "")) to.searchParams.set("tenant", url.searchParams.get("tenant"));
      return redirect(to.toString(), [cookie(stateCookie, state, STATE_SECONDS, { path: basePath, secure })]);
    }

    // A silent "already signed in?" check (prompt=none): at most once a day per browser, so there is no loop and no
    // flash after the first visit. Someone signed in at the login service comes back through /callback as usual;
    // anyone else comes back with error=login_required and simply carries on signed out.
    if (route === "/probe" && (method === "GET" || method === "HEAD")) {
      const to = back(url.searchParams.get("return"));
      if (!configured(env) || readCookie(request, probeCookie)) return redirect(to);
      const state = randomToken();
      const target = new URL(`${accountsOrigin}/sign-in`);
      target.search = new URLSearchParams({ app, return: to, state, callback: `${url.origin}${basePath}/callback`, prompt: "none" }).toString();
      return redirect(target.toString(), [cookie(stateCookie, state, STATE_SECONDS, { path: basePath, secure }), cookie(probeCookie, "1", PROBE_SECONDS, { path: cookiePath, secure })]);
    }

    if (route === "/callback" && method === "GET") {
      const clearState = cookie(stateCookie, "", 0, { path: basePath, secure });
      if (url.searchParams.get("error") === "login_required") {
        const state = readCookie(request, stateCookie);
        if (!state || state !== url.searchParams.get("state")) return redirect(home, [clearState]);
        return redirect(back(url.searchParams.get("return")), [clearState]);
      }
      const failed = (why) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sign-in failed</title><body style="font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1>Sign-in failed</h1><p>${why}</p><p><a href="${signInPath(home)}">Try again</a></p></body>`,
        { status: 400, headers: { "content-type": "text/html; charset=utf-8", ...noStore, "referrer-policy": "no-referrer", "set-cookie": clearState } });
      if (!configured(env)) return text("Sign-in is not available here.", 503);
      const state = readCookie(request, stateCookie);
      const token = url.searchParams.get("token");
      if (!state || !token) return failed("This sign-in expired, or was started in another browser.");
      const claims = await verifyToken(token, { jwks: env.ACCOUNTS_JWKS, audience: app, nonce: await sha256(`nonce:${state}`) });
      if (!claims) return failed("The sign-in could not be checked.");
      let result;
      try {
        result = await service(env).redeem(token, app);
      } catch {
        result = undefined;
      }
      if (!result?.session) return failed(result?.error === "used" ? "This sign-in was already used." : "The sign-in could not be completed.");
      return redirect(back(claims.ret), [clearState, cookie(name, result.session, SESSION_SECONDS, { secure, path: cookiePath })], 303);
    }

    return text("Not found.", 404);
  }

  return { app, cookieName: name, handle, currentUser, entitlements, requireRole, hasRole, signInPath, sessionValue, configured, service };
}
