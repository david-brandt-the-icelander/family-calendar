// Turning a weekly pattern into the occurrences inside a date range.
//
// Pure: dates are YYYY-MM-DD strings and times are HH:MM wall-clock, read as UTC only so
// the arithmetic has no daylight-saving surprises. The schedule's tz travels with the
// result; nothing here converts between zones.

export const MAX_RANGE_DAYS = 62;

const DAY = 86400000;
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);
const toDate = (ms) => new Date(ms).toISOString().slice(0, 10);

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toMs(s))
  && toDate(toMs(s)) === s;
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** ISO weekday, 1 = Monday .. 7 = Sunday. */
export const weekday = (d) => ((new Date(toMs(d)).getUTCDay() + 6) % 7) + 1;

const mondayMs = (d) => toMs(d) - (weekday(d) - 1) * DAY;

/**
 * @param {{id,valid_from,valid_until}} schedule
 * @param {Array<{weekday,start_time,end_time,every_n_weeks,anchor_date}>} rules
 * @param {Array<{date,kind,start_time,end_time,note}>} exceptions
 * @returns {Array<{date,start,end,note?}>} sorted by date then start
 */
export function expand(schedule, rules, exceptions, from, to) {
  const out = [];
  const byDate = new Map();
  for (const e of exceptions) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  for (let ms = toMs(from); ms <= toMs(to); ms += DAY) {
    const d = toDate(ms);
    if (schedule.valid_from && d < schedule.valid_from) continue;
    if (schedule.valid_until && d > schedule.valid_until) continue;

    const ex = byDate.get(d) ?? [];
    const cancelled = ex.some((e) => e.kind === 'cancel');
    const moved = ex.filter((e) => e.kind === 'move');

    if (!cancelled) {
      if (moved.length) {
        for (const e of moved) out.push({ date: d, start: e.start_time, end: e.end_time, note: e.note ?? undefined });
      } else {
        for (const r of rules) {
          if (r.weekday !== weekday(d)) continue;
          if (r.every_n_weeks > 1) {
            const weeks = Math.round((mondayMs(d) - mondayMs(r.anchor_date)) / (7 * DAY));
            if (((weeks % r.every_n_weeks) + r.every_n_weeks) % r.every_n_weeks !== 0) continue;
          }
          out.push({ date: d, start: r.start_time, end: r.end_time });
        }
      }
      for (const e of ex.filter((x) => x.kind === 'add')) {
        out.push({ date: d, start: e.start_time, end: e.end_time, note: e.note ?? undefined });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}
