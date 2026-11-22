// A signed-in person's own settings for the calendar (not the household's): the Upcoming view's range and which family
// dates they want to see. Kept per user id, so they follow the person from phone to laptop. If the table is not there
// yet (migration 0002 not applied), reading gives the defaults and writing says so; the client carries on either way.

import { json, fail } from './lib.js';
import { TYPES } from './family.js';

export const RANGES = ['1m', '3m', '1y', 'all'];
export const DEFAULTS = Object.freeze({ upcomingRange: '3m', familyTypes: ['birthday'], familyCircles: [], upcomingSchedules: false });

export function cleanPrefs(body, base = DEFAULTS) {
  const out = { ...base };
  if (RANGES.includes(body?.upcomingRange)) out.upcomingRange = body.upcomingRange;
  if (Array.isArray(body?.familyTypes)) out.familyTypes = [...new Set(body.familyTypes.filter((t) => TYPES.includes(t)))];
  if (Array.isArray(body?.familyCircles)) {
    out.familyCircles = [...new Set(body.familyCircles.filter((c) => typeof c === 'string' && c.length && c.length <= 80))].slice(0, 50);
  }
  if (typeof body?.upcomingSchedules === 'boolean') out.upcomingSchedules = body.upcomingSchedules;
  return out;
}

async function read(env, userId) {
  const row = await env.DB.prepare('SELECT prefs FROM user_prefs WHERE user_id = ?').bind(userId).first();
  if (!row) return { ...DEFAULTS };
  try { return cleanPrefs(JSON.parse(row.prefs)); } catch { return { ...DEFAULTS }; }
}

export async function getPrefs(env, user) {
  try { return json({ prefs: await read(env, user.id), stored: true }); }
  catch { return json({ prefs: { ...DEFAULTS }, stored: false }); }
}

/** PUT /prefs: a partial update; unknown keys and bad values are ignored. */
export async function putPrefs(env, user, body) {
  try {
    const prefs = cleanPrefs(body, await read(env, user.id));
    await env.DB
      .prepare(`INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (?, ?, datetime('now'))
                ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`)
      .bind(user.id, JSON.stringify(prefs)).run();
    return json({ prefs, stored: true });
  } catch {
    return fail('prefs_unavailable', 503, 'preferences cannot be saved right now');
  }
}
