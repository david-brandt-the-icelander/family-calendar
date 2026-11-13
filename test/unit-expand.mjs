// No network, no database: the expansion rules against hand-worked weeks.
// Prints "<passed> passed, <failed> failed" on the last line.
import { expand, weekday, isDate } from '../src/expand.js';

let pass = 0, fail = 0;
const eq = (label, want, got) => {
  const ok = JSON.stringify(want) === JSON.stringify(got);
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`}`);
  ok ? pass++ : fail++;
};
const s = { valid_from: null, valid_until: null };
const r = (wd, a, b, n = 1, anchor = null) => ({ weekday: wd, start_time: a, end_time: b, every_n_weeks: n, anchor_date: anchor });
const days = (xs) => xs.map((o) => `${o.date} ${o.start}`);

eq('2026-11-09 is a Monday', 1, weekday('2026-11-09'));
eq('2026-11-15 is a Sunday', 7, weekday('2026-11-15'));
eq('rejects 2026-02-30', false, isDate('2026-02-30'));

eq('weekly rule over two weeks', ['2026-11-10 16:00', '2026-11-17 16:00'],
  days(expand(s, [r(2, '16:00', '16:45')], [], '2026-11-09', '2026-11-22')));

// Fortnightly, anchored on the week of 2026-11-09: that week and every second one after.
eq('alternate weeks', ['2026-11-11 08:00', '2026-11-25 08:00'],
  days(expand(s, [r(3, '08:00', '16:00', 2, '2026-11-09')], [], '2026-11-09', '2026-12-01')));
eq('alternate weeks before the anchor', ['2026-10-28 08:00'],
  days(expand(s, [r(3, '08:00', '16:00', 2, '2026-11-09')], [], '2026-10-26', '2026-11-08')));

eq('valid_until stops it', ['2026-11-10 16:00'],
  days(expand({ valid_from: null, valid_until: '2026-11-12' }, [r(2, '16:00', '17:00')], [], '2026-11-09', '2026-11-22')));
eq('valid_from starts it', ['2026-11-17 16:00'],
  days(expand({ valid_from: '2026-11-13', valid_until: null }, [r(2, '16:00', '17:00')], [], '2026-11-09', '2026-11-22')));

const ex = (date, kind, a = null, b = null) => ({ date, kind, start_time: a, end_time: b, note: null });
eq('cancel', ['2026-11-17 16:00'],
  days(expand(s, [r(2, '16:00', '17:00')], [ex('2026-11-10', 'cancel')], '2026-11-09', '2026-11-22')));
eq('move replaces that day', ['2026-11-10 18:00', '2026-11-17 16:00'],
  days(expand(s, [r(2, '16:00', '17:00')], [ex('2026-11-10', 'move', '18:00', '19:00')], '2026-11-09', '2026-11-22')));
eq('add gives an extra', ['2026-11-10 16:00', '2026-11-12 09:00', '2026-11-17 16:00'],
  days(expand(s, [r(2, '16:00', '17:00')], [ex('2026-11-12', 'add', '09:00', '10:00')], '2026-11-09', '2026-11-22')));
eq('cancel beats add on the same day', ['2026-11-17 16:00'],
  days(expand(s, [r(2, '16:00', '17:00')], [ex('2026-11-10', 'cancel'), ex('2026-11-10', 'add', '09:00', '10:00')], '2026-11-09', '2026-11-22')));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
