// Types for index.js (icelander-auth). Vendored together with it.

export declare const VERSION: string;
export declare const ISSUER: string;
export declare const SESSION_SECONDS: number;

/** A signed-in user, as the login service reports them for one app. */
export interface User {
  /** Stable id: "a-" and 24 hex digits for users made by signing in. */
  id: string;
  /** The primary verified address, lower case. */
  email: string;
  /** Every verified address of the user, the primary first. */
  emails: string[];
  name: string;
  picture: string | null;
  /** This app's roles only, e.g. ["site:reader", "games:play", "games:recreations"]. */
  roles: string[];
  supporter: boolean;
  /** The ids icelander.net (and The Puppetmaster, before the login service) gave this person, per linked provider: { google: "a-…" }. */
  accountIds: Record<string, string>;
  /**
   * How this session was made: "provider" (Google, GitHub, Facebook, Discord), "email" (a magic link) or "link" (a
   * Snekkjó guest's own link). Only a provider's sessions carry roles beyond the implicit ones.
   */
  via: "provider" | "email" | "link";
  /**
   * The active tenants the person is in (docs/tenants.md), for an app the login service lists as tenant-aware and a
   * provider's sign-in; [] otherwise. Added in 2.2.0: an older login service leaves it out.
   */
  tenants?: TenantRef[];
  /** The tenant this session acts in (chosen at sign-in, else the person's only one), or null. */
  tenant?: TenantRef | null;
  /** Only on a local host's stand-in sign-in. */
  dev?: boolean;
}

/** The generic roles in a tenant; apps map them to their own permissions. */
export type TenantRole = "owner" | "admin" | "member" | "guest";
export declare const TENANT_ROLES: TenantRole[];
export interface TenantRef { id: string; name: string; role: TenantRole; /** What an app calls the person inside this tenant, when set. */ handle?: string }
export interface TenantMember { user: string; role: TenantRole; handle: string | null }
export interface TenantInfo { id: string; name: string; kind: "household" | "org" | "personal"; status: "active" | "disabled" }
/** What the login service's binding answers about tenants, for any service that has it (z3, Snekkjó, …). Members are ids only. */
export interface TenantDirectory {
  /** The active tenants of one person, by name. */
  tenantsOf(userId: string): Promise<TenantRef[]>;
  /** The person's role in one active tenant, or null. */
  membership(userId: string, tenantId: string): Promise<TenantRef | null>;
  /** A tenant, disabled ones too, with its members; null if there is no such tenant. */
  tenant(tenantId: string): Promise<{ tenant: TenantInfo; members: TenantMember[] } | null>;
}
/** The person's role in this tenant (from a user an app got from the login service), or undefined. */
export declare function tenantRole(user: User | null | undefined, tenantId: string): TenantRole | undefined;
/** Whether the person holds at least this role in the tenant. */
export declare function tenantAtLeast(user: User | null | undefined, tenantId: string, role: TenantRole): boolean;

/** What an app reaches the login service through: a service binding to its Internal entrypoint. */
export interface AccountsBinding extends Partial<TenantDirectory> {
  redeem(token: string, app: string): Promise<{ session?: string; user?: User; error?: string }>;
  session(session: string, app: string): Promise<User | null>;
  signOut(session: string, app: string): Promise<void>;
  signOutEverywhere(session: string, app: string): Promise<void>;
  heartbeat(session: string, app: string, game: string): Promise<{ minutes: number } | null>;
  tips(session: string, app: string, shown?: boolean): Promise<TipPrompt>;
  admin(session: string, app: string, op: string, args?: Record<string, unknown>): Promise<{ result?: unknown; error?: string }>;
  entitlements?(session: string, app: string): Promise<Entitlements | null>;
  entitlementsOf?(userId: string, app: string): Promise<Entitlements | null>;
  requestAccess?(session: string, app: string, capability: string): Promise<{ ok?: true; error?: string }>;
  openSession?(app: string, who: { id: string; name: string; email?: string }, reason: string): Promise<{ session?: string; error?: string }>;
}

/** What an app may give a person (docs/identity-app-plan.md, 5.3): their rank, this app's limits, and the owner's separate approvals. */
export interface Entitlements {
  user: string;
  rank: { id: string; level: number; name: string; source: string; until: number | null };
  roles: string[];
  /** This app's limits only; null is no limit, a key the rank has no number for is 0. */
  limits: Record<string, number | null>;
  limitsSource: Record<string, "rank" | "override" | "self">;
  /** The costly capabilities the owner approved for this person ("ai-images", "write-keys"). */
  approvals: string[];
  dollarCeilingCents: number | null;
  /** Changes whenever anything about the person's entitlements changes. */
  v: number;
  /** Seconds an answer may be kept. */
  ttl: number;
}

export interface TipPrompt {
  show: "none" | "line" | "card";
  prices: { label: string; amount: number }[];
  url: string;
}

export interface AuthEnv {
  /** The binding, under its default name; an app may name it otherwise (AuthOptions.binding). */
  ACCOUNTS?: AccountsBinding;
  /** The login service's public keys (JWKS JSON). */
  ACCOUNTS_JWKS?: string;
  /** "true" only for local runs and tests. */
  DEV_SIGN_IN?: string;
}

export interface AuthOptions {
  app: string;
  cookie: string;
  basePath?: string;
  home?: string;
  accountsOrigin?: string;
  bearer?: boolean;
  /** The role every signed-in user holds for this app, after the colon (default "play"). */
  implicitRole?: string;
  /** The env name of the service binding to the login service (default "ACCOUNTS"). */
  binding?: string;
  /** The Path of the app's cookie (default "/"). */
  cookiePath?: string;
  /** Other apps' role prefixes this app's stand-in sign-in may grant (e.g. "games" for the site). */
  rolePrefixes?: string[];
}

export interface Auth {
  app: string;
  cookieName: string;
  handle(request: Request, env: AuthEnv): Promise<Response | undefined>;
  currentUser(request: Request, env: AuthEnv): Promise<User | null>;
  /** The person's rank and this app's limits, kept for the answer's ttl; { fresh: true } asks again (use before anything that costs money). */
  entitlements(request: Request, env: AuthEnv, options?: { fresh?: boolean }): Promise<Entitlements | null>;
  requireRole(request: Request, env: AuthEnv, role: string, options?: { api?: boolean }): Promise<{ user: User; response?: undefined } | { user?: User | null; response: Response }>;
  hasRole(user: User | null | undefined, role: string): boolean;
  signInPath(returnTo: string): string;
  sessionValue(request: Request): string | undefined;
  configured(env: AuthEnv): boolean;
  /** The login service's binding in this env, under the configured name. */
  service(env: AuthEnv): AccountsBinding | undefined;
}

export declare function createAuth(options: AuthOptions): Auth;

/** One limit of an answer: 0 if there is no answer or no such limit, Infinity for no limit. */
export declare function limitOf(answer: Entitlements | null | undefined, key: string): number;
/** Whether the owner approved this capability for the person. */
export declare function approved(answer: Entitlements | null | undefined, capability: string): boolean;

/** The claims of an access token the identity app issued for an MCP server (typ at+jwt). */
export interface AccessTokenClaims { iss: string; aud: string; sub: string; scope: string; client_id: string; gid: string; /** The tenant the token acts in, when the resource is tenant-aware. */ tid?: string; iat: number; exp: number; jti: string }
export declare const OAUTH_ISSUER: string;
/** Checks an access token's signature (against pinned keys), type, issuer, resource, lifetime and scope; undefined if anything is off. */
export declare function verifyAccessToken(token: string, options: { jwks: string | object; resource: string; now?: number; issuer?: string }): Promise<AccessTokenClaims | undefined>;

export interface TokenClaims {
  /** The tenant this sign-in acts in (an app that opted in; the person is a member). */
  tid?: string;
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  nonce?: string;
  ret?: string;
}

export declare function verifyToken(
  token: unknown,
  options: { jwks: unknown; audience: string; nonce?: string; now?: number; issuer?: string },
): Promise<TokenClaims | undefined>;
export declare function parseJwks(jwks: unknown): { kty: "OKP"; crv: "Ed25519"; kid: string; x: string }[];
export declare function safeReturn(value: unknown, fallback?: string, basePath?: string): string;
export declare function sameOrigin(request: Request, url?: URL): boolean;
export declare function readCookie(request: Request, name: string): string | undefined;
export declare function cookie(name: string, value: string, seconds: number, options?: { path?: string; secure?: boolean }): string;
export declare function isLocal(url: URL): boolean;
export declare function base64url(bytes: Uint8Array): string;
export declare function fromBase64url(text: string): Uint8Array;
export declare function randomToken(bytes?: number): string;
export declare function sha256(text: string): Promise<string>;
