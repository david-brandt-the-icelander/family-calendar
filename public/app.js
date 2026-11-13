// The family calendar client: one module, hash routing, no framework. Text only ever goes
// through textContent, never innerHTML.
import { STRINGS } from './i18n.js';

const lang = (localStorage.getItem('lang') || navigator.language || 'is').startsWith('en') ? 'en' : 'is';
const T = STRINGS[lang];
const root = document.getElementById('app');
const state = { me: null, people: [], picked: new Set(), weekStart: mondayOf(iso(new Date())) };

// ------------------------------------------------------------------ helpers
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
function mondayOf(s) { const d = parse(s); return addDays(s, -((d.getDay() + 6) % 7)); }
const label = (s) => { const d = parse(s); return `${d.getDate()}. ${T.months[d.getMonth()]}`; };

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

async function api(method, path, body) {
  const res = await fetch(`/calendar/api${path}`, {
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
        h('a', { href: '#/stundaskrar', class: route === 'sched' ? 'on' : '' }, T.schedules),
        h('a', { href: '#/heimilid', class: route === 'home' ? 'on' : '' }, T.household)),
      h('button', { class: 'dim', onclick: signOut }, T.signout)),
    body);
}

function signedOut() {
  const failed = new URLSearchParams(location.search).get('invite') === 'invalid';
  root.replaceChildren(h('div', { class: 'card' },
    h('h1', {}, T.app), h('p', { class: 'dim' }, T.signinBlurb),
    failed ? h('p', { class: 'msg' }, T.invalidInvite) : null,
    h('a', { href: '/calendar/auth/sign-in?return=/calendar/' }, h('button', { class: 'primary' }, T.signin))));
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
  const { occurrences } = await api('GET', `/agenda?${q}`);
  const today = iso(new Date());

  const days = [...Array(7)].map((_, i) => {
    const d = addDays(from, i);
    const occ = occurrences.filter((o) => o.date === d);
    return h('div', { class: `day ${d === today ? 'today' : ''}` },
      h('h3', {}, `${T.days[i]} ${label(d)}`),
      occ.length ? occ.map((o) => h('div', { class: 'occ', style: `--c:${o.colour || colourOf(o.owner_id)}` },
        h('b', {}, o.title),
        h('span', {}, `${o.start}–${o.end}`, state.picked.size === 1 ? '' : ` · ${nameOf(o.owner_id)}`)))
        : h('span', { class: 'dim' }, T.nothing));
  });

  shell('week', [
    chips(),
    h('div', { class: 'bar' },
      h('button', { onclick: () => { state.weekStart = addDays(from, -7); render(); } }, '‹ ' + T.prev),
      h('div', { class: 'grow' }, `${label(from)} – ${label(to)}`),
      h('button', { onclick: () => { state.weekStart = mondayOf(today); render(); } }, T.today),
      h('button', { onclick: () => { state.weekStart = addDays(from, 7); render(); } }, T.next + ' ›')),
    h('div', { class: 'week' }, days)]);
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
  await fetch('/calendar/auth/sign-out', { method: 'POST', headers: { origin: location.origin } }).catch(() => {});
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
      h('button', { class: 'primary', onclick: () => run(async () => { const r = await api('POST', '/household/invites'); linkBox.value = r.url; linkBox.select(); }) }, T.invite),
      h('div', { class: 'row' }, linkBox)) : null,
    msg]);
}

// ------------------------------------------------------------------ routing
async function loadPeople() { state.people = (await api('GET', '/people')).people; }

async function render() {
  try {
    if (!state.me) { state.me = await api('GET', '/me'); await loadPeople(); }
    if (location.hash.startsWith('#/stundaskrar')) await schedulesView();
    else if (location.hash.startsWith('#/heimilid')) await householdView();
    else await weekView();
  } catch (e) {
    if (e.status === 401) signedOut();
    else root.replaceChildren(h('p', { class: 'msg' }, say(e)));
  }
}
addEventListener('hashchange', render);
render();
