// The Worker answers under /apps/z-calendar, signs in there with its own callback and cookie path, and sends its two old
// addresses, /calendar and /apps/calendar, to the same path there with a 301 (GET and HEAD only, the query kept).
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const JWKS = JSON.stringify({ keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'k2026a', x: 'WIEomi0LTalJvQndhD7abl8ty3YcliQ0vEz4XjLXayc' }] });
const env = (extra = {}) => ({ ACCOUNTS_JWKS: JWKS, ACCOUNTS: { session: async () => null }, ASSETS: { fetch: async () => new Response('page') }, ...extra });
const get = (path, init) => new Request(`https://icelander.net${path}`, init);
const BASE = '/apps/z-calendar';

// The home: sign-in for the app "calendar" with the new callback, the state cookie on its path, the API behind it.
const r = await worker.fetch(get(`${BASE}/auth/sign-in?return=${BASE}/`), env());
assert.equal(r.status, 302);
const to = new URL(r.headers.get('location'));
assert.equal(to.searchParams.get('app'), 'calendar');
assert.equal(to.searchParams.get('callback'), 'https://icelander.net/apps/z-calendar/auth/callback');
assert.equal(to.searchParams.get('return'), `${BASE}/`);
assert.match(r.headers.getSetCookie().join(';'), /calendar_session_state=.*Path=\/apps\/z-calendar\/auth/);
assert.equal((await worker.fetch(get(`${BASE}/health`), env())).status, 200);
assert.equal((await worker.fetch(get(`${BASE}/api/me`), env())).status, 401, 'the API needs a sign-in');
assert.equal((await worker.fetch(get(BASE), env())).status, 301, 'the trailing slash, as before');
assert.equal((await worker.fetch(get(BASE), env())).headers.get('location'), `https://icelander.net${BASE}/`);

// The old addresses: a 301 to the same path, query kept, for GET and HEAD; anything else is refused, not repeated.
for (const old of ['/calendar', '/apps/calendar']) {
  for (const [path, want] of [
    ['', '/'], ['/', '/'], ['/app.js', '/app.js'], ['/api/people?x=1&y=2', '/api/people?x=1&y=2'],
    ['/join/AAAAAAAAAAAAAAAAAAAA?ref=mail', '/join/AAAAAAAAAAAAAAAAAAAA?ref=mail'],
    ['/auth/callback?code=c&state=s', '/auth/callback?code=c&state=s'], ['/health', '/health'],
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const res = await worker.fetch(get(`${old}${path}`, { method }), env());
      assert.equal(res.status, 301, `${method} ${old}${path}`);
      assert.equal(res.headers.get('location'), `https://icelander.net${BASE}${want}`, `${method} ${old}${path}`);
    }
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await worker.fetch(get(`${old}/api/people`, { method }), env());
    assert.equal(res.status, 405, `${method} ${old}`);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
    assert.equal((await res.json()).code, 'moved');
  }
}
// Only those paths: lookalikes are not the calendar's.
assert.equal((await worker.fetch(get('/calendars'), env())).status, 404);
assert.equal((await worker.fetch(get('/apps/calendarx/'), env())).status, 404);
assert.equal((await worker.fetch(get('/apps/z-calendarx/'), env())).status, 404);
assert.equal((await worker.fetch(get('/elsewhere'), env())).status, 404);
console.log('base path: ok');
