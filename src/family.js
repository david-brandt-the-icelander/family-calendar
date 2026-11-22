// Family dates — birthdays, anniversaries, death dates, events and pets — from z-friends-and-family (z-faf), which owns
// the people and decides what each viewer may see. This Worker only asks, through the FAF service binding (entrypoint
// Internal), and passes the answer on, cleaned. Nothing about these people is stored here.
//
// Fail soft: if the binding is missing, throws, hangs or answers nonsense, the calendar still works and the client
// shows a small notice. (Sign-in, by contrast, fails closed: that is icelander-auth's and is not touched here.)

import { json, fail } from './lib.js';

export const TYPES = ['birthday', 'anniversary', 'death', 'event', 'pet'];
export const KINDS = ['family', 'contact'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEOUT_MS = 3000;

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));

/** A comma list from the query: undefined when absent (no filter), [] when present and empty (filter everything out). */
function listParam(url, name, allowed) {
  if (!url.searchParams.has(name)) return undefined;
  const items = url.searchParams.get(name).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50).map((s) => s.slice(0, 80));
  return allowed ? items.filter((s) => allowed.includes(s)) : items;
}

/** Links go to icelander.net only: a path on the site, or an absolute https URL on it. Anything else is dropped. */
export function safeUrl(u) {
  if (typeof u !== 'string' || u.length > 500) return null;
  if (u.startsWith('/') && !u.startsWith('//') && !u.includes('\\')) return u;
  try { const p = new URL(u); return p.protocol === 'https:' && p.hostname === 'icelander.net' ? p.href : null; } catch { return null; }
}

/** One row from z-faf as the client may see it, or null if it is not a usable date. */
export function cleanDate(r) {
  if (!r || typeof r !== 'object' || !TYPES.includes(r.type) || typeof r.nextDate !== 'string' || !DATE_RE.test(r.nextDate)) return null;
  const year = Number.isInteger(r.year) ? r.year : null;
  const span = year == null ? null : Number(r.nextDate.slice(0, 4)) - year;
  return {
    personId: str(r.personId, 80),
    name: str(r.name, 120),
    kind: KINDS.includes(r.kind) ? r.kind : 'contact',
    type: r.type,
    label: str(r.label, 120),
    month: Number.isInteger(r.month) ? r.month : Number(r.nextDate.slice(5, 7)),
    day: Number.isInteger(r.day) ? r.day : Number(r.nextDate.slice(8, 10)),
    year,
    // z-faf says 'unset' for somebody the viewer has put in no circle: that is no circle, not one called "unset".
    circle: r.circle == null || r.circle === '' || r.circle === 'unset' ? null : str(r.circle, 80),
    nextDate: r.nextDate,
    // An age (birthday, pet), years married (anniversary) or years since (death, event) on nextDate; null when unknown.
    years: span != null && span >= 0 ? span : null,
    url: safeUrl(r.url),
  };
}

const unavailable = (reason) => json({ available: false, reason, dates: [], circles: [] });

/**
 * GET /family-dates?from=&to=[&types=a,b][&kinds=a,b][&circles=a,b]: the viewer's family dates whose next occurrence on or
 * after `from` falls on or before `to`. `circles` filters here, after the list of every circle seen (for the filter
 * itself) is taken, so ticking one circle does not hide the others from the picker.
 */
export async function familyDates(env, user, url) {
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!DATE_RE.test(from ?? '') || !DATE_RE.test(to ?? '') || from > to) return fail('bad_date', 400, 'from and to are YYYY-MM-DD, from first');
  const types = listParam(url, 'types', TYPES), kinds = listParam(url, 'kinds', KINDS), circles = listParam(url, 'circles');
  if (types?.length === 0 || kinds?.length === 0) return json({ available: true, dates: [], circles: [] });

  if (!env.FAF || typeof env.FAF.dates !== 'function') return unavailable('missing');
  const opts = { from, to };
  if (types) opts.types = types;
  if (kinds) opts.kinds = kinds;

  let rows, timer;
  try {
    rows = await Promise.race([
      env.FAF.dates({ id: user.id, email: user.email }, opts),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); }),
    ]);
  } catch (e) {
    console.log(JSON.stringify({ level: 'warn', msg: 'faf_failed', error: String(e) }));
    return unavailable('failed');
  } finally { clearTimeout(timer); }
  if (!Array.isArray(rows)) return unavailable('failed');

  const dates = rows.slice(0, 5000).map(cleanDate).filter(Boolean);
  const seen = [...new Set(dates.map((d) => d.circle).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const shown = circles ? dates.filter((d) => circles.includes(d.circle ?? '')) : dates;
  shown.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name));
  return json({ available: true, dates: shown, circles: seen });
}
