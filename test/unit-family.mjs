// Family dates from the FAF binding (src/family.js) and a person's preferences (src/prefs.js), with made-up data: what is
// asked of friends-and-family, what reaches the client, and that the calendar carries on when friends-and-family is missing or broken.
import assert from 'node:assert/strict';
import { familyDates, cleanDate, safeUrl } from '../src/family.js';
import { cleanPrefs, DEFAULTS } from '../src/prefs.js';

const user = { id: 'a-000000000000000000000001', email: 'tester@x.test', name: 'Tester' };
const url = (q) => new URL(`https://icelander.net/apps/z-calendar/api/family-dates?${q}`);
const row = (o) => ({ personId: 'p1', name: 'Made Up', kind: 'family', type: 'birthday', label: 'Birthday', month: 3, day: 4, year: 1990, circle: 'Family', nextDate: '2027-03-04', url: 'https://icelander.net/apps/friends-and-family/person/p1', ...o });
const call = async (env, q = 'from=2027-01-01&to=2027-12-31') => { const r = await familyDates(env, user, url(q)); return { status: r.status, body: await r.json() }; };

// What friends-and-family is asked: the viewer as { id, email }, the range, and the types and kinds asked for.
let asked;
const faf = (rows) => ({ dates: async (viewer, opts) => { asked = { viewer, opts }; return rows; } });
let res = await call({ FAF: faf([row()]) }, 'from=2027-01-01&to=2027-12-31&types=birthday,pet,bogus&kinds=family');
assert.deepEqual(asked.viewer, { id: user.id, email: user.email });
assert.deepEqual(asked.opts, { from: '2027-01-01', to: '2027-12-31', types: ['birthday', 'pet'], kinds: ['family'] });
assert.equal(res.body.available, true);
assert.equal(res.body.dates[0].years, 37, 'turns 37 on 2027-03-04');
await call({ FAF: faf([]) });
assert.deepEqual(asked.opts, { from: '2027-01-01', to: '2027-12-31' }, 'no filters asked when none given');

// Every box unticked: nothing, and friends-and-family is not asked at all.
asked = null;
res = await call({ FAF: faf([row()]) }, 'from=2027-01-01&to=2027-12-31&types=');
assert.deepEqual(res.body, { available: true, dates: [], circles: [] });
assert.equal(asked, null);

// Circles: every circle seen is listed for the picker, and only the ones asked for are shown, sorted by date.
const rows = [row({ circle: 'Work', nextDate: '2027-05-01', personId: 'w' }), row({ circle: 'Family', nextDate: '2027-02-01', personId: 'f' }), row({ circle: 'unset', personId: 'n' })];
res = await call({ FAF: faf(rows) }, 'from=2027-01-01&to=2027-12-31&circles=Family,Work');
assert.deepEqual(res.body.circles, ['Family', 'Work']);
assert.deepEqual(res.body.dates.map((d) => d.personId), ['f', 'w']);
res = await call({ FAF: faf(rows) });
assert.deepEqual(res.body.dates.map((d) => d.personId), ['f', 'n', 'w'], 'no circle filter: all, by date');

// Bad ranges are the client's mistake, not friends-and-family's.
assert.equal((await call({ FAF: faf([]) }, 'from=2027-02-01&to=2027-01-01')).status, 400);
assert.equal((await call({ FAF: faf([]) }, 'from=x&to=2027-01-01')).status, 400);

// Fail soft: missing, throwing, or answering nonsense all give 200, available false, and no dates.
for (const [why, env, reason] of [
  ['no binding', {}, 'missing'],
  ['a binding without dates()', { FAF: {} }, 'missing'],
  ['it throws', { FAF: { dates: async () => { throw new Error('down'); } } }, 'failed'],
  ['it answers nonsense', { FAF: { dates: async () => ({ not: 'a list' }) } }, 'failed'],
]) {
  const log = console.log; console.log = () => {};
  try { res = await call(env); } finally { console.log = log; }
  assert.equal(res.status, 200, why);
  assert.deepEqual(res.body, { available: false, reason, dates: [], circles: [] }, why);
}

// Cleaning: unusable rows dropped, links kept on icelander.net only, years only when the year is known.
assert.equal(cleanDate(row({ type: 'wedding' })), null);
assert.equal(cleanDate(row({ nextDate: '4 March' })), null);
assert.equal(cleanDate(null), null);
assert.equal(cleanDate(row({ year: null })).years, null);
assert.equal(cleanDate(row({ year: 2030 })).years, null, 'no negative ages');
assert.equal(cleanDate(row({ type: 'anniversary', year: 2015 })).years, 12);
assert.equal(cleanDate(row({ kind: 'stranger' })).kind, 'contact');
assert.equal(cleanDate(row({ circle: 'unset' })).circle, null, "friends-and-family's 'unset' is no circle");
assert.equal(cleanDate(row()).url, 'https://icelander.net/apps/friends-and-family/person/p1');
assert.equal(safeUrl('/apps/friends-and-family/person/p1'), '/apps/friends-and-family/person/p1');
assert.equal(safeUrl('https://icelander.net/apps/friends-and-family/person/p1'), 'https://icelander.net/apps/friends-and-family/person/p1');
for (const bad of ['javascript:alert(1)', '//evil.test/x', 'https://evil.test/', 'http://icelander.net/x', '/\\evil.test', 42, null]) assert.equal(safeUrl(bad), null, String(bad));

// Preferences: defaults (3 months, birthdays only), and only known values kept.
assert.deepEqual(cleanPrefs({}), DEFAULTS);
assert.equal(DEFAULTS.upcomingRange, '3m');
assert.deepEqual(DEFAULTS.familyTypes, ['birthday']);
assert.deepEqual(cleanPrefs({ upcomingRange: '1y', familyTypes: ['pet', 'pet', 'x'], familyCircles: ['Friends', 7, ''], upcomingSchedules: 'yes' }),
  { upcomingRange: '1y', familyTypes: ['pet'], familyCircles: ['Friends'], upcomingSchedules: false });
assert.equal(cleanPrefs({ upcomingRange: '10y' }).upcomingRange, '3m');
assert.equal(cleanPrefs({ upcomingRange: 'all' }, { ...DEFAULTS, familyTypes: ['death'] }).familyTypes[0], 'death', 'a partial update keeps the rest');
console.log('family dates: ok');
