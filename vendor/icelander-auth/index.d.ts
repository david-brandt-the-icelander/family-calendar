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
  /** Only on a local host's stand-in sign-in. */
  dev?: boolean;
}

/** What an app reaches the login service through: a service binding to its Internal entrypoint. */
export interface AccountsBinding {
  redeem(token: string, app: string): Promise<{ session?: string; user?: User; error?: string }>;
  session(session: string, app: string): Promise<User | null>;
  signOut(session: string, app: string): Promise<void>;
  signOutEverywhere(session: string, app: string): Promise<void>;
  heartbeat(session: string, app: string, game: string): Promise<{ minutes: number } | null>;
  tips(session: string, app: string, shown?: boolean): Promise<TipPrompt>;
  admin(session: string, app: string, op: string, args?: Record<string, unknown>): Promise<{ result?: unknown; error?: string }>;
  openSession?(app: string, who: { id: string; name: string; email?: string }, reason: string): Promise<{ session?: string; error?: string }>;
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
  requireRole(request: Request, env: AuthEnv, role: string, options?: { api?: boolean }): Promise<{ user: User; response?: undefined } | { user?: User | null; response: Response }>;
  hasRole(user: User | null | undefined, role: string): boolean;
  signInPath(returnTo: string): string;
  sessionValue(request: Request): string | undefined;
  configured(env: AuthEnv): boolean;
  /** The login service's binding in this env, under the configured name. */
  service(env: AuthEnv): AccountsBinding | undefined;
}

export declare function createAuth(options: AuthOptions): Auth;

export interface TokenClaims {
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
