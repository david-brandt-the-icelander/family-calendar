// The Worker answers under both /apps/calendar and /calendar, each with its own sign-in (callback and cookie path),
// and, only when OLD_PATH_REDIRECTS is "true", sends the old path to the new with a 308 (the old callback excepted).
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const JWKS = JSON.stringify({ keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'k2026a', x: 'WIEomi0LTalJvQndhD7abl8ty3YcliQ0vEz4XjLXayc' }] });
const env = (extra = {}) => ({ ACCOUNTS_JWKS: JWKS, ACCOUNTS: { session: async () => null }, ASSETS: { fetch: async () => new Response('page') }, ...extra });
const get = (path, init) => new Request(`https://icelander.net${path}`, init);

for (const base of ['/calendar', '/apps/calendar']) {
  const r = await worker.fetch(get(`${base}/auth/sign-in?return=${base}/`), env());
  assert.equal(r.status, 302, base);
  const to = new URL(r.headers.get('location'));
  assert.equal(to.searchParams.get('app'), 'calendar');
  assert.equal(to.searchParams.get('callback'), `https://icelander.net${base}/auth/callback`);
  assert.equal(to.searchParams.get('return'), `${base}/`);
  const cookie = r.headers.getSetCookie().join(';');
  assert.match(cookie, new RegExp(`calendar_session_state=.*Path=${base}/auth`), base);
  assert.equal((await worker.fetch(get(`${base}/health`), env())).status, 200);
  assert.equal((await worker.fetch(get(`${base}/api/me`), env())).status, 401, 'the API needs a sign-in');
}
assert.equal((await worker.fetch(get('/apps/calendar'), env())).status, 301); // the trailing slash, as before
assert.equal((await worker.fetch(get('/calendar'), env())).status, 301);

// Off by default: the old path is served as it always was.
assert.equal((await worker.fetch(get('/calendar/api/me'), env())).status, 401);

// On: a 308 for any method, the query kept, and the old callback untouched.
const on = env({ OLD_PATH_REDIRECTS: 'true' });
for (const method of ['GET', 'POST', 'DELETE']) {
  const r = await worker.fetch(get('/calendar/api/people?x=1', { method }), on);
  assert.equal(r.status, 308, method);
  assert.equal(r.headers.get('location'), 'https://icelander.net/apps/calendar/api/people?x=1');
}
assert.equal((await worker.fetch(get('/calendar/'), on)).headers.get('location'), 'https://icelander.net/apps/calendar/');
const cb = await worker.fetch(get('/calendar/auth/callback'), on);
assert.notEqual(cb.status, 308, 'the old callback keeps answering');
assert.equal((await worker.fetch(get('/apps/calendar/api/me'), on)).status, 401, 'the new path is never redirected');
assert.equal((await worker.fetch(get('/elsewhere'), on)).status, 404);
console.log('base path: ok');
