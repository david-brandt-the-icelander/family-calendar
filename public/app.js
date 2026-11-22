// The family calendar client: one module, hash routing, no framework. Text only ever goes
// through textContent, never innerHTML.
import { STRINGS } from './i18n.js';

const lang = (localStorage.getItem('lang') || navigator.language || 'is').startsWith('en') ? 'en' : 'is';
const T = STRINGS[lang];
const root = document.getElementById('app');
const state = { me: null, people: [], picked: new Set(), weekStart: mondayOf(iso(new Date())), prefs: null };

// ------------------------------------------------------------------ helpers
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
function mondayOf(s) { const d = parse(s); return addDays(s, -((d.getDay() + 6) % 7)); }
const label = (s) => { const d = parse(s); return `${d.getDate()}. ${T.months[d.getMonth()]}`; };
function addMonths(s, n) { const d = parse(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return iso(d); }

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

// The page is served under /apps/z-calendar; its old addresses redirect here.
const BASE = '/apps/z-calendar';
// z-friends-and-family: where the family dates come from, and where contacts are imported.
const FAF_IMPORT = '/apps/z-friends-and-family/import';

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { code: data.code, status: res.status });
  return data;
}
const say = (e) => T.err[e.code] || T.generic;

const PALETTE = ['#6aa9ff', '#ffb86a', '#7ee0a0', '#e58bff', '#ff8b8b', '#e8d96a', '#6ae0e0'];
const colourOf = (id) => {
  const p = state.people.find((x) => x.id === id);
  if (p?.colour) return p.colour;
  return PALETTE[Math.max(0, state.people.findIndex((x) => x.id === id)) % PALETTE.length];
};
const nameOf = (id) => state.people.find((p) => p.id === id)?.name ?? '';

// -------------------------------------------------------------------- shell
function shell(route, body) {
  root.replaceChildren(
    h('header', {},
      h('h1', {}, T.app),
      h('nav', {},
        h('a', { href: '#/', class: route === 'week' ? 'on' : '' }, T.week),
        h('a', { href: '#/framundan', class: route === 'upcoming' ? 'on' : '' }, T.upcoming),
        h('a', { href: '#/stundaskrar', class: route === 'sched' ? 'on' : '' }, T.schedules),
        h('a', { href: '#/heimilid', class: route === 'home' ? 'on' : '' }, T.household)),
      h('button', { class: 'dim', onclick: signOut }, T.signout)),
    // A view hands over a list (with nested lists and nulls for parts it leaves out); replaceChildren
    // would turn an array into its text.
    ...[body].flat(Infinity).filter(Boolean));
}

function signedOut() {
  const failed = new URLSearchParams(location.search).get('invite') === 'invalid';
  root.replaceChildren(h('div', { class: 'card' },
    h('h1', {}, T.app), h('p', { class: 'dim' }, T.signinBlurb),
    failed ? h('p', { class: 'msg' }, T.invalidInvite) : null,
    h('a', { href: `${BASE}/auth/sign-in?return=${BASE}/` }, h('button', { class: 'primary' }, T.signin))));
}


// ------------------------------------------------------------ family dates
// Birthdays, anniversaries and the rest come from z-friends-and-family, already cut to what this person may see. They are
// all-day items, drawn apart from schedules, and each links to the person's page there. If z-faf does not answer, the
// calendar works as before with a line saying so.
const FAMILY_TYPES = ['birthday', 'anniversary', 'death', 'event', 'pet'];
const ICONS = { birthday: '🎂', anniversary: '💍', death: '✝', event: '★', pet: '🐾' };
const DEFAULT_PREFS = { upcomingRange: '3m', familyTypes: ['birthday'], familyCircles: [], upcomingSchedules: false };

async function loadPrefs() {
  if (state.prefs) return;
  try { state.prefs = { ...DEFAULT_PREFS, ...(await api('GET', '/prefs')).prefs }; }
  catch { state.prefs = { ...DEFAULT_PREFS }; }
}
/** Change a setting now, and keep it for this person on the server; a failure to save only means it is not remembered. */
function setPref(change) {
  Object.assign(state.prefs, change);
  api('PUT', '/prefs', change).catch(() => {});
  render();
}

async function familyDates(from, to) {
  const q = new URLSearchParams({ from, to, types: state.prefs.familyTypes.join(',') });
  if (state.prefs.familyCircles.length) q.set('circles', state.prefs.familyCircles.join(','));
  try { return await api('GET', `/family-dates?${q}`); }
  catch (e) { if (e.status === 401) throw e; return { available: false, dates: [], circles: [] }; }
}

/** "turns 40", "12 years" and so on, when the year is known. */
function yearsText(d) {
  if (d.years == null || (d.years === 0 && d.type !== 'birthday' && d.type !== 'pet')) return '';
  return T.years[d.type](d.years);
}

function famItem(d, { withDate = false } = {}) {
  const extra = [d.label, yearsText(d)].filter(Boolean).join(' · ');
  return h(d.url ? 'a' : 'div', { class: `fam fam-${d.type}`, href: d.url || null, title: T.familyTypes[d.type], 'data-type': d.type },
    h('span', { class: 'ico', 'aria-hidden': 'true' }, ICONS[d.type]),
    h('span', { class: 'txt' },
      withDate ? h('span', { class: 'when' }, label(d.nextDate)) : null,
      h('b', {}, d.name),
      extra ? h('span', { class: 'sub' }, extra) : null));
}

/** Which kinds of date, and which circles; the same on the week and on Upcoming. */
function familyFilters(fam) {
  const p = state.prefs;
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const circles = [...new Set([...(fam.circles || []), ...p.familyCircles])];
  return h('div', { class: 'famfilter' },
    h('div', { class: 'row types' }, FAMILY_TYPES.map((t) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: p.familyTypes.includes(t), 'data-type': t, onchange: () => setPref({ familyTypes: toggle(p.familyTypes, t) }) }),
      `${ICONS[t]} ${T.familyTypes[t]}`))),
    circles.length ? h('div', { class: 'row circles' },
      h('span', { class: 'dim' }, T.circles),
      h('button', { class: `chip ${p.familyCircles.length === 0 ? 'on' : ''}`, onclick: () => setPref({ familyCircles: [] }) }, T.allCircles),
      circles.map((c) => h('button', { class: `chip ${p.familyCircles.includes(c) ? 'on' : ''}`, 'data-circle': c, onclick: () => setPref({ familyCircles: toggle(p.familyCircles, c) }) }, c)))
      : null,
    fam.available ? null : h('p', { class: 'notice' }, T.familyUnavailable));
}

// ---------------------------------------------------------------- week view
function chips() {
  return h('div', { class: 'chips' },
    h('button', { class: `chip ${state.picked.size === 0 ? 'on' : ''}`, onclick: () => { state.picked.clear(); render(); } }, T.everyone),
    state.people.map((p) => h('button', {
      class: `chip ${state.picked.has(p.id) ? 'on' : ''}`, style: `--c:${colourOf(p.id)}`,
      onclick: () => { state.picked.has(p.id) ? state.picked.delete(p.id) : state.picked.add(p.id); render(); },
    }, p.name)));
}

async function weekView() {
  const from = state.weekStart, to = addDays(from, 6);
  const q = new URLSearchParams({ from, to });
  if (state.picked.size) q.set('people', [...state.picked].join(','));
  const [{ occurrences }, fam] = await Promise.all([api('GET', `/agenda?${q}`), familyDates(from, to)]);
  const today = iso(new Date());

  const days = [...Array(7)].map((_, i) => {
    const d = addDays(from, i);
    const occ = occurrences.filter((o) => o.date === d);
    const dates = fam.dates.filter((x) => x.nextDate === d);
    return h('div', { class: `day ${d === today ? 'today' : ''}` },
      h('h3', {}, `${T.days[i]} ${label(d)}`),
      dates.length ? h('div', { class: 'allday' }, dates.map((x) => famItem(x))) : null,
      occ.length ? occ.map((o) => h('div', { class: 'occ', style: `--c:${o.colour || colourOf(o.owner_id)}` },
        h('b', {}, o.title),
        h('span', {}, `${o.start}–${o.end}`, state.picked.size === 1 ? '' : ` · ${nameOf(o.owner_id)}`)))
        : dates.length ? null : h('span', { class: 'dim' }, T.nothing));
  });

  shell('week', [
    chips(),
    familyFilters(fam),
    h('div', { class: 'bar' },
      h('button', { onclick: () => { state.weekStart = addDays(from, -7); render(); } }, '‹ ' + T.prev),
      h('div', { class: 'grow' }, `${label(from)} – ${label(to)}`),
      h('button', { onclick: () => { state.weekStart = mondayOf(today); render(); } }, T.today),
      h('button', { onclick: () => { state.weekStart = addDays(from, 7); render(); } }, T.next + ' ›')),
    h('div', { class: 'week' }, days)]);
}


// ------------------------------------------------------------- upcoming
// Family dates (and, if asked, schedules) from today on: the next month, three months, a year, or every date at its next
// occurrence. The range is remembered for the person (PUT /prefs).
const RANGES = ['1m', '3m', '1y', 'all'];
const rangeEnd = (from, r) => (r === '1m' ? addDays(addMonths(from, 1), -1) : r === '3m' ? addDays(addMonths(from, 3), -1)
  : r === '1y' ? addDays(addMonths(from, 12), -1) : '9999-12-31');
const SCHEDULE_RANGES = ['1m', '3m'];   // a year of weekly lessons would bury the dates

async function agendaFor(from, to) {
  const out = [];
  for (let a = from; a <= to; a = addDays(a, 62)) {
    const b = addDays(a, 61) < to ? addDays(a, 61) : to;
    out.push(...(await api('GET', `/agenda?${new URLSearchParams({ from: a, to: b })}`)).occurrences);
  }
  return out;
}

async function upcomingView() {
  const p = state.prefs, today = iso(new Date()), range = RANGES.includes(p.upcomingRange) ? p.upcomingRange : '3m';
  const to = rangeEnd(today, range);
  const withSchedules = p.upcomingSchedules && SCHEDULE_RANGES.includes(range);
  const [fam, occ] = await Promise.all([familyDates(today, to), withSchedules ? agendaFor(today, to) : []]);

  const items = [
    ...fam.dates.map((d) => ({ date: d.nextDate, el: famItem(d, { withDate: true }) })),
    ...occ.map((o) => ({ date: o.date, el: h('div', { class: 'occ', style: `--c:${o.colour || colourOf(o.owner_id)}` },
      h('span', { class: 'when' }, label(o.date)), h('b', {}, o.title), h('span', {}, `${o.start}–${o.end} · ${nameOf(o.owner_id)}`)) })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // One heading per month (with its year when it is not this year).
  const groups = [];
  for (const it of items) {
    const key = it.date.slice(0, 7);
    if (groups.at(-1)?.key !== key) groups.push({ key, items: [] });
    groups.at(-1).items.push(it);
  }
  const monthName = (key) => { const [y, m] = key.split('-').map(Number); return `${T.monthsLong[m - 1]}${y === parse(today).getFullYear() ? '' : ` ${y}`}`; };

  shell('upcoming', [
    h('div', { class: 'bar ranges', role: 'group', 'aria-label': T.range },
      RANGES.map((r) => h('button', { class: `seg ${r === range ? 'on' : ''}`, 'aria-pressed': String(r === range), 'data-range': r, onclick: () => setPref({ upcomingRange: r }) }, T.ranges[r]))),
    familyFilters(fam),
    h('div', { class: 'row' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: withSchedules, disabled: !SCHEDULE_RANGES.includes(range), onchange: (e) => setPref({ upcomingSchedules: e.target.checked }) }),
        SCHEDULE_RANGES.includes(range) ? T.withSchedules : T.withSchedulesShort),
      h('a', { class: 'import', href: FAF_IMPORT }, T.importContacts)),
    groups.length
      ? h('div', { class: 'upcoming' }, groups.map((g) => h('section', { class: 'month' }, h('h3', {}, monthName(g.key)), g.items.map((i) => i.el))))
      : h('p', { class: 'dim' }, T.nothingUpcoming)]);
}

// ---------------------------------------------------------- schedule editor
function ruleRow(r, onchange, onremove) {
  const n = h('input', { type: 'number', min: 1, max: 8, value: r.every_n_weeks, style: 'width:70px' });
  const anchor = h('input', { type: 'date', value: r.anchor_date || '' });
  const wd = h('select', {}, T.daysLong.map((name, i) => h('option', { value: i + 1, selected: r.weekday === i + 1 }, name)));
  const a = h('input', { type: 'time', value: r.start_time }), b = h('input', { type: 'time', value: r.end_time });
  const sync = () => onchange({ weekday: +wd.value, start_time: a.value, end_time: b.value, every_n_weeks: +n.value, anchor_date: anchor.value || null });
  for (const el of [n, anchor, wd, a, b]) el.addEventListener('change', sync);
  return h('div', { class: 'row' }, wd, a, b,
    h('label', {}, T.everyN, n), h('label', {}, T.anchor, anchor),
    h('button', { class: 'danger', onclick: onremove }, '✕'));
}

function scheduleCard(s) {
  const msg = h('div', { class: 'msg' });
  const f = {
    title: h('input', { value: s.title, disabled: !s.can_edit }),
    kind: h('select', {}, Object.entries(T.kinds).map(([k, v]) => h('option', { value: k, selected: s.kind === k }, v))),
    valid_from: h('input', { type: 'date', value: s.valid_from || '' }),
    valid_until: h('input', { type: 'date', value: s.valid_until || '' }),
  };
  let rules = s.rules.map(({ weekday, start_time, end_time, every_n_weeks, anchor_date }) => ({ weekday, start_time, end_time, every_n_weeks, anchor_date }));
  const list = h('div');
  const draw = () => list.replaceChildren(...rules.map((r, i) => ruleRow(r, (v) => { rules[i] = v; }, () => { rules.splice(i, 1); draw(); })));
  draw();

  const exDate = h('input', { type: 'date' });
  const exKind = h('select', {}, Object.entries(T.exKinds).map(([k, v]) => h('option', { value: k }, v)));
  const exA = h('input', { type: 'time' }), exB = h('input', { type: 'time' });

  const run = async (fn) => { msg.textContent = ''; try { await fn(); await render(); } catch (e) { msg.textContent = say(e); } };
  const save = () => run(async () => {
    await api('PATCH', `/schedules/${s.id}`, {
      title: f.title.value, kind: f.kind.value,
      valid_from: f.valid_from.value || null, valid_until: f.valid_until.value || null });
    await api('PUT', `/schedules/${s.id}/rules`, { rules });
  });

  return h('div', { class: 'card', style: `border-left:4px solid ${colourOf(s.owner_id)}` },
    h('div', { class: 'dim' }, nameOf(s.owner_id)),
    h('div', { class: 'row' }, h('label', {}, T.title, f.title), h('label', {}, T.kind, f.kind)),
    h('div', { class: 'row' }, h('label', {}, T.validFrom, f.valid_from), h('label', {}, T.validUntil, f.valid_until)),
    h('h4', {}, T.rules), list,
    h('button', { onclick: () => { rules.push({ weekday: 1, start_time: '09:00', end_time: '10:00', every_n_weeks: 1, anchor_date: null }); draw(); } }, T.addRule),
    h('h4', {}, T.exceptions),
    h('div', { class: 'row' }, exDate, exKind, exA, exB,
      h('button', { onclick: () => run(() => api('POST', `/schedules/${s.id}/exceptions`, { date: exDate.value, kind: exKind.value, start_time: exA.value || null, end_time: exB.value || null })) }, T.add)),
    msg,
    s.can_edit ? h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: save }, T.save),
      h('button', { class: 'danger', onclick: () => run(() => api('DELETE', `/schedules/${s.id}`)) }, T.remove)) : null);
}

async function schedulesView() {
  const { schedules } = await api('GET', '/schedules');
  const msg = h('div', { class: 'msg' });
  const owner = h('select', {}, state.people.map((p) => h('option', { value: `${p.kind}:${p.id}` }, p.name)));
  const title = h('input', { placeholder: T.title });
  const kind = h('select', {}, Object.entries(T.kinds).map(([k, v]) => h('option', { value: k }, v)));
  const pname = h('input', { placeholder: T.personName });

  const add = async () => {
    msg.textContent = '';
    const [owner_kind, owner_id] = owner.value.split(':');
    try { await api('POST', '/schedules', { owner_kind, owner_id, title: title.value, kind: kind.value }); await render(); }
    catch (e) { msg.textContent = say(e); }
  };
  const addPerson = async () => {
    try { await api('POST', '/people', { name: pname.value }); await loadPeople(); await render(); }
    catch (e) { msg.textContent = say(e); }
  };

  shell('sched', [
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('label', {}, T.owner, owner), h('label', {}, T.title, title), h('label', {}, T.kind, kind),
        h('button', { class: 'primary', onclick: add }, T.add)),
      h('div', { class: 'row' }, pname, h('button', { onclick: addPerson }, T.newPerson)),
      msg),
    schedules.length ? schedules.map(scheduleCard) : h('p', { class: 'dim' }, T.noSchedules)]);
}


async function signOut() {
  await fetch(`${BASE}/auth/sign-out`, { method: 'POST', headers: { origin: location.origin } }).catch(() => {});
  state.me = null; location.hash = '#/'; location.reload();
}

async function householdView() {
  const { household, members } = await api('GET', '/household');
  const admin = household.role === 'admin';
  const msg = h('div', { class: 'msg' });
  const linkBox = h('input', { readonly: true, style: 'width:100%', onclick: (e) => e.target.select() });
  const name = h('input', { value: household.name, disabled: !admin });
  const run = async (fn) => { msg.textContent = ''; try { await fn(); await render(); } catch (e) { msg.textContent = say(e); } };

  shell('home', [
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('label', {}, T.household, name),
        admin ? h('button', { onclick: () => run(() => api('PATCH', '/household', { name: name.value })) }, T.rename) : null)),
    h('div', { class: 'card' }, h('h4', {}, T.members),
      members.map((m) => h('div', { class: 'row' },
        h('span', {}, m.name), m.role === 'admin' ? h('span', { class: 'dim' }, T.admin) : null,
        (admin && m.id !== state.me.user.id) || m.id === state.me.user.id
          ? h('button', { class: 'danger', onclick: () => run(async () => { await api('DELETE', `/household/members/${m.id}`); if (m.id === state.me.user.id) state.me = null; }) },
            m.id === state.me.user.id ? T.leave : T.remove) : null))),
    admin ? h('div', { class: 'card' }, h('h4', {}, T.invite), h('p', { class: 'dim' }, T.inviteHelp),
      // Not through run(): redrawing the screen would throw the new link away.
      h('button', { class: 'primary', onclick: async () => {
        msg.textContent = '';
        try { const r = await api('POST', '/household/invites'); linkBox.value = r.url; linkBox.select(); }
        catch (e) { msg.textContent = say(e); }
      } }, T.invite),
      h('div', { class: 'row' }, linkBox)) : null,
    msg]);
}

// ------------------------------------------------------------------ routing
async function loadPeople() { state.people = (await api('GET', '/people')).people; }

async function render() {
  try {
    // People are fetched on every screen: somebody may have joined since the page loaded.
    if (!state.me) state.me = await api('GET', '/me');
    await Promise.all([loadPeople(), loadPrefs()]);
    if (location.hash.startsWith('#/framundan')) await upcomingView();
    else if (location.hash.startsWith('#/stundaskrar')) await schedulesView();
    else if (location.hash.startsWith('#/heimilid')) await householdView();
    else await weekView();
  } catch (e) {
    if (e.status === 401) signedOut();
    else root.replaceChildren(h('p', { class: 'msg' }, say(e)));
  }
}
addEventListener('hashchange', render);
render();
