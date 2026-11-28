// Stands in for friends-and-family's Internal entrypoint in the tests. Made-up people only (this repository is public).
// Dates are set relative to today, so the browser tests find them in this week, the next month and so on:
//
//   Ari Prófason     birthday       today            born 40 years ago   circle Family   family
//   Bára Dæmadóttir  anniversary    today + 10 days  12 years            circle Family   family
//   Snati            pet            today + 3 days   born 4 years ago    circle Family   family
//   Gamli Jón        death          today + 45 days  30 years ago        circle unset    family
//   Dísa Vinkona     birthday       today + 20 days  year unknown        circle Friends  contact
//   Kári Kollegi     event          today + 200 days one-off, this date  circle Work     contact
//   Lóa Langtburt    event          today + 500 days one-off             circle Friends  contact
//
// Shaped like the real one (friends-and-family, branch david/friends-and-family-v1): full https://icelander.net links to person/<id>,
// 'unset' for no circle, a one-off event's year given back as null.
// A viewer whose email starts with "faf-down" makes it throw, to show the calendar carries on without it.
import { WorkerEntrypoint } from 'cloudflare:workers';

const iso = (d) => d.toISOString().slice(0, 10);
const plus = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d; };

function people() {
  const at = (n, back) => { const d = plus(n); return { month: d.getUTCMonth() + 1, day: d.getUTCDate(), year: back == null ? null : d.getUTCFullYear() - back }; };
  return [
    { personId: 'p-ari', name: 'Ari Prófason', kind: 'family', type: 'birthday', label: 'Afmæli', ...at(0, 40), circle: 'Family' },
    { personId: 'p-bara', name: 'Bára Dæmadóttir', kind: 'family', type: 'anniversary', label: 'Brúðkaupsafmæli', ...at(10, 12), circle: 'Family' },
    { personId: 'p-snati', name: 'Snati', kind: 'family', type: 'pet', label: 'Afmæli', ...at(3, 4), circle: 'Family' },
    { personId: 'p-jon', name: 'Gamli Jón', kind: 'family', type: 'death', label: 'Dánardægur', ...at(45, 30), circle: 'unset' },
    { personId: 'p-disa', name: 'Dísa Vinkona', kind: 'contact', type: 'birthday', label: 'Afmæli', ...at(20, null), circle: 'Friends' },
    { personId: 'p-kari', name: 'Kári Kollegi', kind: 'contact', type: 'event', label: 'Útskrift', ...at(200, 0), circle: 'Work', once: true },
    { personId: 'p-loa', name: 'Lóa Langtburt', kind: 'contact', type: 'event', label: 'Heimkoma', ...at(500, 0), circle: 'Friends', once: true },
  ];
}

/** The first occurrence on or after `from`: every year for most dates, just the one day for a one-off event. */
function next(p, from) {
  const pad = (n) => String(n).padStart(2, '0');
  if (p.once) return `${p.year}-${pad(p.month)}-${pad(p.day)}` >= from ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : null;
  let y = Number(from.slice(0, 4));
  if (`${y}-${pad(p.month)}-${pad(p.day)}` < from) y += 1;
  return `${y}-${pad(p.month)}-${pad(p.day)}`;
}

export class Internal extends WorkerEntrypoint {
  async dates(viewer, opts) {
    if (String(viewer?.email ?? '').startsWith('faf-down')) throw new Error('friends-and-family is down (on purpose, in the tests)');
    if (!viewer?.id) throw new Error('no viewer');
    const { from, to, types, kinds, circles } = opts ?? {};
    return people()
      .filter((p) => (!types || types.includes(p.type)) && (!kinds || kinds.includes(p.kind)) && (!circles || circles.includes(p.circle)))
      .map((p) => ({ ...p, nextDate: next(p, from) }))
      .filter((p) => p.nextDate && p.nextDate <= to)
      .map(({ once, ...p }) => ({ ...p, year: once ? null : p.year, url: `https://icelander.net/apps/friends-and-family/person/${p.personId}` }));
  }
}

export default { fetch: () => new Response('friends-and-family stand-in', { status: 404 }) };
