// People, schedules, their weekly rules and exceptions, and the agenda.
//
// Authority: any household member reads everything in it; a member edits their own
// schedules and those of people without a sign-in; an admin edits anyone's. Every statement
// carries household_id, and an id from the URL is only ever looked up together with it.

import { json, fail, uuid } from './lib.js';
import { members } from './households.js';
import { expand, isDate, isTime, MAX_RANGE_DAYS } from './expand.js';

const KINDS = ['work', 'school', 'activity', 'other'];
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;
const tzOk = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ------------------------------------------------------------------ people

/** Everyone a schedule can belong to: signed-in members and dependants. */
export async function listPeople(env, householdId) {
  const [m, d] = await Promise.all([
    members(env, householdId),
    env.DB.prepare('SELECT id, name, colour FROM people WHERE household_id = ? ORDER BY name').bind(householdId).all(),
  ]);
  return [
    ...m.map((u) => ({ id: u.id, kind: 'user', name: u.name, picture: u.picture, role: u.role })),
    ...(d.results ?? []).map((p) => ({ id: p.id, kind: 'person', name: p.name, colour: p.colour })),
  ];
}

export async function addPerson(env, user, householdId, body) {
  const name = text(body.name, 80);
  if (!name) return fail('name_required', 400, 'name is required');
  const colour = COLOUR_RE.test(body.colour ?? '') ? body.colour : null;
  const id = uuid();
  await env.DB
    .prepare('INSERT INTO people (id, household_id, name, colour, created_by) VALUES (?,?,?,?,?)')
    .bind(id, householdId, name, colour, user.id).run();
  return json({ id, kind: 'person', name, colour }, 201);
}

export async function removePerson(env, householdId, personId) {
  // The schedules go with them: nobody else can see or edit what they had.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM schedules WHERE household_id = ? AND owner_kind = 'person' AND owner_id = ?`).bind(householdId, personId),
    env.DB.prepare('DELETE FROM people WHERE household_id = ? AND id = ?').bind(householdId, personId),
  ]);
  return json({ ok: true });
}

// --------------------------------------------------------------- schedules

async function ownerExists(env, householdId, kind, id) {
  if (kind === 'user') return (await members(env, householdId)).some((u) => u.id === id);
  return !!(await env.DB.prepare('SELECT 1 AS x FROM people WHERE household_id = ? AND id = ?').bind(householdId, id).first());
}

/** May `user` change a schedule owned by (kind, id)? */
const mayEdit = (user, role, sched) =>
  role === 'admin' || sched.owner_kind === 'person' || sched.owner_id === user.id;

async function load(env, householdId, id) {
  return env.DB.prepare('SELECT * FROM schedules WHERE household_id = ? AND id = ?').bind(householdId, id).first();
}

function readSchedule(body, base = {}) {
  const s = { ...base };
  if ('title' in body) { s.title = text(body.title, 120); if (!s.title) return { error: ['title_required', 'title is required'] }; }
  if ('kind' in body) { if (!KINDS.includes(body.kind)) return { error: ['bad_kind', 'kind is not one of ' + KINDS] }; s.kind = body.kind; }
  if ('colour' in body) { if (body.colour && !COLOUR_RE.test(body.colour)) return { error: ['bad_colour', 'colour is #rrggbb'] }; s.colour = body.colour || null; }
  if ('tz' in body) { if (!tzOk(body.tz)) return { error: ['bad_tz', 'unknown time zone'] }; s.tz = body.tz; }
  for (const k of ['valid_from', 'valid_until']) {
    if (k in body) { if (body[k] && !isDate(body[k])) return { error: ['bad_date', `${k} must be YYYY-MM-DD`] }; s[k] = body[k] || null; }
  }
  if (s.valid_from && s.valid_until && s.valid_until < s.valid_from) return { error: ['bad_range', 'valid_until is before valid_from'] };
  return { s };
}

export async function listSchedules(env, user, role, householdId, ownerId) {
  const q = ownerId
    ? env.DB.prepare('SELECT * FROM schedules WHERE household_id = ? AND owner_id = ? ORDER BY title').bind(householdId, ownerId)
    : env.DB.prepare('SELECT * FROM schedules WHERE household_id = ? ORDER BY title').bind(householdId);
  const rows = (await q.all()).results ?? [];
  const ids = rows.map((r) => r.id);
  const rules = ids.length
    ? (await env.DB.prepare(`SELECT * FROM schedule_rules WHERE schedule_id IN (${ids.map(() => '?').join(',')}) ORDER BY weekday, start_time`).bind(...ids).all()).results ?? []
    : [];
  return json({
    schedules: rows.map((s) => ({
      ...s,
      can_edit: mayEdit(user, role, s),
      rules: rules.filter((r) => r.schedule_id === s.id),
    })),
  });
}

export async function createSchedule(env, user, role, householdId, body) {
  const kind = body.owner_kind === 'person' ? 'person' : 'user';
  const ownerId = body.owner_id || user.id;
  if (!(await ownerExists(env, householdId, kind, ownerId))) return fail('owner_not_found', 404, 'no such person in this household');
  if (!mayEdit(user, role, { owner_kind: kind, owner_id: ownerId })) return fail('forbidden', 403, 'you cannot change this person\'s schedules');

  const r = readSchedule(body, { kind: 'other', tz: 'Atlantic/Reykjavik', colour: null, valid_from: null, valid_until: null });
  if (r.error) return fail(r.error[0], 400, r.error[1]);
  if (!r.s.title) return fail('title_required', 400, 'title is required');

  const id = uuid();
  const s = r.s;
  await env.DB
    .prepare(
      `INSERT INTO schedules (id, household_id, owner_kind, owner_id, title, kind, colour, tz, valid_from, valid_until, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(id, householdId, kind, ownerId, s.title, s.kind, s.colour, s.tz, s.valid_from, s.valid_until, user.id)
    .run();
  return json({ id }, 201);
}

export async function updateSchedule(env, user, role, householdId, id, body) {
  const cur = await load(env, householdId, id);
  if (!cur) return fail('not_found', 404, 'no such schedule');
  if (!mayEdit(user, role, cur)) return fail('forbidden', 403, 'not yours to change');
  const r = readSchedule(body, cur);
  if (r.error) return fail(r.error[0], 400, r.error[1]);
  const s = r.s;
  await env.DB
    .prepare(
      `UPDATE schedules SET title=?, kind=?, colour=?, tz=?, valid_from=?, valid_until=?, updated_at=datetime('now')
        WHERE household_id=? AND id=?`
    )
    .bind(s.title, s.kind, s.colour, s.tz, s.valid_from, s.valid_until, householdId, id).run();
  return json({ ok: true });
}

export async function deleteSchedule(env, user, role, householdId, id) {
  const cur = await load(env, householdId, id);
  if (!cur) return fail('not_found', 404, 'no such schedule');
  if (!mayEdit(user, role, cur)) return fail('forbidden', 403, 'not yours to change');
  await env.DB.prepare('DELETE FROM schedules WHERE household_id = ? AND id = ?').bind(householdId, id).run();
  return json({ ok: true });
}

// ------------------------------------------------------------ rules, exceptions

/** Replace the whole weekly pattern: the client edits it as one list. */
export async function putRules(env, user, role, householdId, id, body) {
  const cur = await load(env, householdId, id);
  if (!cur) return fail('not_found', 404, 'no such schedule');
  if (!mayEdit(user, role, cur)) return fail('forbidden', 403, 'not yours to change');
  if (!Array.isArray(body.rules) || body.rules.length > 50) return fail('bad_rules', 400, 'rules must be a list of at most 50');

  const rows = [];
  for (const r of body.rules) {
    const n = Number(r.every_n_weeks ?? 1);
    if (!Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) return fail('bad_weekday', 400, 'weekday is 1 (Monday) to 7');
    if (!isTime(r.start_time) || !isTime(r.end_time) || r.end_time <= r.start_time) return fail('bad_time', 400, 'times are HH:MM and end after start');
    if (!Number.isInteger(n) || n < 1 || n > 8) return fail('bad_interval', 400, 'every_n_weeks is 1 to 8');
    if (n > 1 && !isDate(r.anchor_date)) return fail('anchor_required', 400, 'alternating weeks need an anchor_date');
    rows.push([uuid(), id, r.weekday, r.start_time, r.end_time, n, n > 1 ? r.anchor_date : null]);
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM schedule_rules WHERE schedule_id = ?').bind(id),
    ...rows.map((v) => env.DB.prepare(
      'INSERT INTO schedule_rules (id, schedule_id, weekday, start_time, end_time, every_n_weeks, anchor_date) VALUES (?,?,?,?,?,?,?)').bind(...v)),
  ]);
  return json({ ok: true, count: rows.length });
}

export async function addException(env, user, role, householdId, id, body) {
  const cur = await load(env, householdId, id);
  if (!cur) return fail('not_found', 404, 'no such schedule');
  if (!mayEdit(user, role, cur)) return fail('forbidden', 403, 'not yours to change');
  if (!isDate(body.date)) return fail('bad_date', 400, 'date must be YYYY-MM-DD');
  if (!['cancel', 'move', 'add'].includes(body.kind)) return fail('bad_kind', 400, 'kind is cancel, move or add');
  let a = null, b = null;
  if (body.kind !== 'cancel') {
    if (!isTime(body.start_time) || !isTime(body.end_time) || body.end_time <= body.start_time) return fail('bad_time', 400, 'times are HH:MM and end after start');
    a = body.start_time; b = body.end_time;
  }
  const eid = uuid();
  await env.DB
    .prepare('INSERT INTO schedule_exceptions (id, schedule_id, date, kind, start_time, end_time, note) VALUES (?,?,?,?,?,?,?)')
    .bind(eid, id, body.date, body.kind, a, b, text(body.note, 200) || null).run();
  return json({ id: eid }, 201);
}

export async function deleteException(env, user, role, householdId, id, eid) {
  const cur = await load(env, householdId, id);
  if (!cur) return fail('not_found', 404, 'no such schedule');
  if (!mayEdit(user, role, cur)) return fail('forbidden', 403, 'not yours to change');
  await env.DB.prepare('DELETE FROM schedule_exceptions WHERE schedule_id = ? AND id = ?').bind(id, eid).run();
  return json({ ok: true });
}

export async function listExceptions(env, householdId, id, from, to) {
  if (!(await load(env, householdId, id))) return fail('not_found', 404, 'no such schedule');
  const rows = await env.DB
    .prepare('SELECT * FROM schedule_exceptions WHERE schedule_id = ? AND date >= ? AND date <= ? ORDER BY date')
    .bind(id, from, to).all();
  return json({ exceptions: rows.results ?? [] });
}

// ------------------------------------------------------------------ agenda

/**
 * GET /api/agenda?from=&to=&people=a,b — expanded occurrences for the people asked for, or
 * everybody. Everyone in the household sees everything in it.
 */
export async function agenda(env, householdId, url) {
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!isDate(from) || !isDate(to) || to < from) return fail('bad_range', 400, 'from and to must be YYYY-MM-DD, to not before from');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= MAX_RANGE_DAYS) return fail('range_too_long', 400, `at most ${MAX_RANGE_DAYS} days`);

  const want = (url.searchParams.get('people') ?? '').split(',').filter(Boolean);
  const people = await listPeople(env, householdId);
  const named = new Map(people.map((p) => [p.id, p]));
  const who = want.length ? want.filter((id) => named.has(id)) : people.map((p) => p.id);
  if (!who.length) return json({ occurrences: [] });

  const scheds = (await env.DB
    .prepare(`SELECT * FROM schedules WHERE household_id = ? AND owner_id IN (${who.map(() => '?').join(',')})`)
    .bind(householdId, ...who).all()).results ?? [];
  if (!scheds.length) return json({ occurrences: [] });

  const ids = scheds.map((s) => s.id), q = ids.map(() => '?').join(',');
  const [rules, exc] = await Promise.all([
    env.DB.prepare(`SELECT * FROM schedule_rules WHERE schedule_id IN (${q})`).bind(...ids).all(),
    env.DB.prepare(`SELECT * FROM schedule_exceptions WHERE schedule_id IN (${q}) AND date >= ? AND date <= ?`).bind(...ids, from, to).all(),
  ]);

  const occurrences = [];
  for (const s of scheds) {
    const own = (rows) => (rows.results ?? []).filter((r) => r.schedule_id === s.id);
    for (const o of expand(s, own(rules), own(exc), from, to)) {
      occurrences.push({
        ...o, schedule_id: s.id, owner_id: s.owner_id, owner_kind: s.owner_kind,
        title: s.title, kind: s.kind, colour: s.colour, tz: s.tz,
      });
    }
  }
  occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return json({ occurrences });
}
