// Family calendar — a shared calendar for a household, at icelander.net/calendar.
//
// Sign-in is icelander.net's one login service (Google and the rest), through the vendored
// icelander-auth library and a service binding; nothing here talks to Google. This Worker keeps
// households, their people and their weekly schedules in its own D1.

import { createAuth } from '../vendor/icelander-auth/index.js';
import { json, fail, readJson } from './lib.js';
import {
  touchMember, myHouseholds, createHouseholdFor, membership, members, renameHousehold,
  createInvite, listInvites, revokeInvite, acceptInvite, removeMember, INVITE_RE,
} from './households.js';
import * as S from './schedules.js';

const BASE = '/calendar';
const UUID_RE = /^[0-9a-fA-F-]{8,36}$/;

export const auth = createAuth({
  app: 'calendar', cookie: 'calendar_session',
  basePath: `${BASE}/auth`, cookiePath: BASE, home: `${BASE}/`,
});

export default {
  async fetch(request, env) {
    try { return await route(request, env, new URL(request.url)); }
    catch (e) {
      console.log(JSON.stringify({ level: 'error', msg: 'request_threw', path: new URL(request.url).pathname, error: String(e) }));
      return fail('internal', 500, 'something went wrong on our side');
    }
  },
};

async function route(request, env, url) {
  // /auth/sign-in, /auth/callback, /auth/sign-out, /auth/me — and /auth/dev on localhost with DEV_SIGN_IN.
  const answered = await auth.handle(request, env);
  if (answered) return answered;

  // Relative asset URLs need the trailing slash.
  if (url.pathname === BASE) return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);

  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/health' || path === `${BASE}/health`) return json({ ok: true });
  if (path !== BASE && !path.startsWith(`${BASE}/`)) return new Response('Not found', { status: 404 });
  const rest = path.slice(BASE.length) || '/';

  // ---------------------------------------------------------------- invite
  const join = rest.match(/^\/join\/([^/]+)$/);
  if (join) {
    const user = await auth.currentUser(request, env);
    if (!user) return Response.redirect(`${url.origin}${BASE}/auth/sign-in?return=${encodeURIComponent(path)}`, 302);
    if (!INVITE_RE.test(join[1]) || !(await acceptInvite(env, user, join[1]))) {
      return Response.redirect(`${url.origin}${BASE}/?invite=invalid`, 302);
    }
    return Response.redirect(`${url.origin}${BASE}/`, 302);
  }

  if (!rest.startsWith('/api/')) return assets(request, env, url, rest);

  // -------------------------------------------------------------------- api
  const user = await auth.currentUser(request, env);
  if (!user) return fail('unauthenticated', 401, 'sign in first');
  await touchMember(env, user);

  let households = await myHouseholds(env, user.id);
  if (!households.length) households = [await createHouseholdFor(env, user)];

  const seg = rest.split('/').slice(2);
  const method = request.method;

  if (seg[0] === 'me' && !seg[1]) {
    return json({ user: { id: user.id, name: user.name, picture: user.picture, email: user.email }, households });
  }

  // Everything else is inside one household: ?household= or, failing that, the user's first.
  const asked = url.searchParams.get('household');
  if (asked && !UUID_RE.test(asked)) return fail('bad_household', 400, 'bad household id');
  const household = asked ? households.find((h) => h.id === asked) : households[0];
  if (!household) return fail('forbidden', 403, 'not your household');
  const householdId = household.id, role = household.role;
  const admin = role === 'admin';

  if (seg[0] === 'household') {
    if (!seg[1]) {
      if (method === 'GET') return json({ household, members: await members(env, householdId) });
      if (method === 'PATCH') return admin ? renameHousehold(env, householdId, await readJson(request)) : fail('forbidden', 403, 'admins only');
    }
    if (seg[1] === 'invites') {
      if (!admin) return fail('forbidden', 403, 'admins only');
      if (method === 'GET') return listInvites(env, householdId);
      if (method === 'POST') return createInvite(env, user, householdId, url.origin);
      if (method === 'DELETE' && seg[2]) return revokeInvite(env, householdId, seg[2]);
    }
    if (seg[1] === 'members' && seg[2] && method === 'DELETE') return removeMember(env, user, role, householdId, seg[2]);
  }

  if (seg[0] === 'people') {
    if (method === 'GET' && !seg[1]) return json({ people: await S.listPeople(env, householdId) });
    if (method === 'POST' && !seg[1]) return S.addPerson(env, user, householdId, await readJson(request));
    if (method === 'DELETE' && seg[1]) return S.removePerson(env, householdId, seg[1]);
  }

  if (seg[0] === 'agenda' && method === 'GET') return S.agenda(env, householdId, url);

  if (seg[0] === 'schedules') {
    const id = seg[1];
    if (!id) {
      if (method === 'GET') return S.listSchedules(env, user, role, householdId, url.searchParams.get('owner'));
      if (method === 'POST') return S.createSchedule(env, user, role, householdId, await readJson(request));
    } else if (UUID_RE.test(id)) {
      if (!seg[2]) {
        if (method === 'PATCH') return S.updateSchedule(env, user, role, householdId, id, await readJson(request));
        if (method === 'DELETE') return S.deleteSchedule(env, user, role, householdId, id);
      }
      if (seg[2] === 'rules' && method === 'PUT') return S.putRules(env, user, role, householdId, id, await readJson(request));
      if (seg[2] === 'exceptions') {
        if (method === 'GET') return S.listExceptions(env, householdId, id, url.searchParams.get('from') ?? '0000-01-01', url.searchParams.get('to') ?? '9999-12-31');
        if (method === 'POST') return S.addException(env, user, role, householdId, id, await readJson(request));
        if (method === 'DELETE' && seg[3]) return S.deleteException(env, user, role, householdId, id, seg[3]);
      }
    }
  }
  return fail('not_found', 404, 'no such route');
}

/** The static client lives at the Worker's root; the site serves it under /calendar. */
function assets(request, env, url, rest) {
  const to = new URL(request.url);
  to.pathname = rest;
  return env.ASSETS.fetch(new Request(to, request));
}
