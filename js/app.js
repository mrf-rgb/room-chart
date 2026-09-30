import * as Mo from './model.js';
import * as store from './store.js';
import { makeDrive } from './drive.js';
import { ChartView, chipsFor } from './chart.js';
import { FILES, VERSION } from './config.js';

const MODES = [
  { id: 'W', label: 'Worksheet', short: 'Work', letter: 'W' },
  { id: 'Pos', label: 'Positive', short: 'Pos', letter: '+' },
  { id: 'Neg', label: 'Negative', short: 'Neg', letter: '−' },
  { id: 'Part', label: 'Participation', short: 'Part', letter: 'P' },
  { id: 'Att', label: 'Attendance', short: 'Att', letter: 'A' },
];
const MODE_NAME = { W: 'Worksheet', Pos: 'Positive', Neg: 'Negative', Part: 'Participation', Abs: 'Attendance', Note: 'Note' };
// Worksheet completion in fifths. Marks made before 1.0.3 (0-3) still show as their own digit.
const W_LEVELS = ['5', '4', '3', '2', '1', '0'];
const W_LABEL = { 5: 'all done', 4: 'most', 3: 'about half', 2: 'some', 1: 'started', 0: 'nothing' };

const S = {
  doc: null, meta: null,
  draft: null, draftNew: false, draftFp: '',
  sel: null, selTable: null, trayPick: null,
  picked: null, recentPicks: {},
  syncing: false, status: '', lastError: '', syncLevel: 'ok',
};
const drive = makeDrive();
const $ = (id) => document.getElementById(id);
let view;

// ---------- helpers ----------

const today = () => Mo.localDate();
const cls = () => S.meta.cls;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
}

function chip(c) { return h('span', { class: 'chipx ' + c.cls, text: c.text }); }

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short' }) + ` ${m}/${d}`;
}

function nameOf(code) { return Mo.displayName(S.doc, cls(), code); }
function namesFn(c) {
  return (code) => {
    const s = Mo.student(S.doc, c, code);
    return { code, name: s && s.name ? s.name : code, hasName: !!(s && s.name) };
  };
}

function currentChart() {
  const list = Mo.liveCharts(S.doc, cls());
  const want = S.meta.chartBy[cls()] || (S.doc.lastOpened[cls()] || {}).chart;
  return list.find((c) => c.id === want) || list[0] || null;
}

function toast(msg, ms = 2600, big = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (big ? ' big' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, ms);
}

async function save(sync = true) {
  await store.put('doc', S.doc);
  await store.put('meta', S.meta);
  if (sync) scheduleSync(4000);
}

// ---------- sheets, prompts, modals ----------

// A tap that opens a menu ends with the browser's own click, which lands on whatever is under the
// finger by then: the new menu. So a menu or screen acts only on a press that began after it opened.
let presses = 0;
function opened(el) { el.dataset.press = presses; el.hidden = false; }
function guardClicks(el) {
  el.addEventListener('click', (e) => {
    if (e.detail && Number(el.dataset.press) === presses) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
}

function closeSheet() { $('sheet').hidden = true; $('sheet').textContent = ''; }

function sheet(title, subtitle, buttons, opts = {}) {
  const sh = $('sheet');
  sh.textContent = '';
  const panel = h('div', { class: 'sheet-panel' + (opts.wide ? ' wide' : '') },
    h('div', { class: 'sheet-title', text: title }),
    subtitle ? h('div', { class: 'sheet-sub', text: subtitle }) : null,
    h('div', { class: 'sheet-buttons' + (opts.grid ? ' grid' : '') + (opts.levels ? ' levels' : '') },
      buttons.map((b) => h('button', {
        class: 'sbtn ' + (b.cls || ''), 'aria-pressed': b.current ? 'true' : null,
        onclick: () => { closeSheet(); b.onClick && b.onClick(); },
      }, b.letter ? h('span', { class: 'sletter', text: b.letter }) : null,
      b.detail ? h('span', { class: 'slabel' }, h('span', { text: b.label }), h('span', { class: 'sdetail', text: b.detail })) : h('span', { text: b.label })))),
    opts.noCancel ? null : h('button', { class: 'sbtn cancel', onclick: closeSheet, text: 'Cancel' }));
  sh.append(panel);
  opened(sh);
}

function prompt(title, value = '', okLabel = 'OK') {
  return new Promise((resolve) => {
    const sh = $('sheet');
    sh.textContent = '';
    const input = h('input', { class: 'pinput', value, type: 'text', autocomplete: 'off' });
    const done = (v) => { closeSheet(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim()); });
    sh.append(h('div', { class: 'sheet-panel' },
      h('div', { class: 'sheet-title', text: title }), input,
      h('div', { class: 'sheet-buttons row' },
        h('button', { class: 'sbtn primary', onclick: () => done(input.value.trim()), text: okLabel }),
        h('button', { class: 'sbtn cancel', onclick: () => done(null), text: 'Cancel' }))));
    opened(sh);
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

function confirmBox(title, sub, okLabel, danger = false) {
  return new Promise((resolve) => {
    sheet(title, sub, [
      { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
      { label: 'Cancel', cls: 'cancel', onClick: () => resolve(false) },
    ], { noCancel: true });
  });
}

function modal(title, body, onClose) {
  const m = $('modal');
  m.textContent = '';
  m.append(h('div', { class: 'modal-head' },
    h('div', { class: 'modal-title', text: title }),
    h('button', { class: 'tbtn', onclick: () => { m.hidden = true; m.textContent = ''; onClose && onClose(); }, text: 'Close' })),
  h('div', { class: 'modal-body' }, body));
  opened(m);
}
function closeModal() { $('modal').hidden = true; $('modal').textContent = ''; }

// ---------- marks ----------

function newMark(mode, code, fields = {}) {
  const t = Mo.nowIso();
  return {
    id: Mo.newId(S.meta.device), t, date: today(), class: cls(), code,
    lesson: Mo.lessonFor(S.doc, cls(), today()), mode, value: '', reason: '', note: '',
    device: S.meta.device, edited: t, ...fields,
  };
}

async function addMark(m) {
  S.doc.marks.push(m);
  await save();
  renderAll();
}

async function editMark(m, fields) {
  Object.assign(m, fields, { edited: Mo.nowIso(), device: S.meta.device });
  await save();
  renderAll();
}

function isAbsent(code) { return Mo.absentCodes(S.doc, cls(), today()).has(code); }

async function setAbsent(code, absent) {
  await addMark(newMark(Mo.M.ABS, code, { value: absent ? 'absent' : 'present' }));
  toast(`${nameOf(code)}: ${absent ? 'absent' : 'present'}`);
}

async function ensureRoll() {
  const d = today();
  if (S.doc.rolls.some((r) => r.class === cls() && r.date === d)) return;
  S.doc.rolls.push({ id: Mo.newId(S.meta.device), date: d, class: cls(), t: Mo.nowIso(), device: S.meta.device });
  await save();
}

// Today's mark for the lesson is changed in place. With none, the value carried from an earlier day
// shows as the current one, and a pick saves a new mark dated today.
function worksheetMenu(code) {
  const lesson = Mo.lessonFor(S.doc, cls(), today());
  const existing = Mo.worksheetMark(S.doc, cls(), today(), code, lesson);
  const carried = !existing && Mo.worksheetCarry(S.doc, cls(), today(), code, lesson);
  const now = existing || carried;
  const pickW = (v) => existing ? editMark(existing, { value: v }) : addMark(newMark(Mo.M.W, code, { value: v }));
  const nowText = existing ? ' · now ' + existing.value : carried ? ` · now ${carried.value}, from ${fmtDate(carried.date)}` : '';
  sheet(nameOf(code), `Worksheet${lesson ? ' · ' + lesson : ''}${nowText}`, [
    ...W_LEVELS.map((v) => ({ label: W_LABEL[v], letter: v, cls: 'c-w' + v, current: now && now.value === v, onClick: () => pickW(v) })),
    { label: 'Absent', letter: 'A', cls: 'c-abs', onClick: () => setAbsent(code, true) },
  ], { levels: true });
}

function reasonMenu(mode, code) {
  const letter = { Pos: '+', Neg: '−', Part: 'P' }[mode];
  const n = Mo.marksOf(S.doc, cls(), today()).filter((m) => m.code === code && m.mode === mode).length;
  sheet(nameOf(code), `${MODE_NAME[mode]}${n ? ' · ' + n + ' today' : ''}`, [
    ...(S.doc.reasons[mode] || []).map((r) => ({ label: r, letter, cls: 'c-' + mode.toLowerCase(), onClick: () => addMark(newMark(mode, code, { reason: r })) })),
    { label: 'Absent', letter: 'A', cls: 'c-abs', onClick: () => setAbsent(code, true) },
  ]);
}

function absentMenu(code) {
  sheet(nameOf(code), 'Absent today. Rounds skip this student.', [
    { label: 'Mark present', cls: 'primary', onClick: () => setAbsent(code, false) },
    { label: 'Open the day', onClick: () => dayView(code) },
  ]);
}

// ---------- chart handlers ----------

function onSeatTap(ti, si) {
  if (S.draft) return editSeatTap(ti, si);
  const ch = currentChart();
  const code = ch && ch.tables[ti] && ch.tables[ti].seats[si];
  if (!code) return;
  const mode = S.meta.mode;
  if (mode === 'Att') return setAbsent(code, !isAbsent(code));
  if (isAbsent(code)) return absentMenu(code);
  // Worksheet marks belong to a lesson: with none set for today, ask first, then open this student's menu.
  if (mode === 'W') return Mo.lessonFor(S.doc, cls(), today()) ? worksheetMenu(code) : lessonMenu(() => worksheetMenu(code));
  return reasonMenu(mode, code);
}

function onSeatLong(ti, si) {
  const ch = currentChart();
  const code = ch && ch.tables[ti] && ch.tables[ti].seats[si];
  if (code) dayView(code);
}

// ---------- day view (long press) ----------

function markLabel(m) {
  if (m.mode === Mo.M.W) return `Worksheet ${m.value}${W_LABEL[m.value] ? ' (' + W_LABEL[m.value] + ')' : ''}${m.lesson ? ' · ' + m.lesson : ''}`;
  if (m.mode === Mo.M.ABS) return m.value === 'absent' ? 'Marked absent' : 'Marked present';
  return `${MODE_NAME[m.mode]}: ${m.reason}`;
}

function markChip(m) {
  if (m.mode === Mo.M.W) return { cls: 'c-w' + m.value, text: m.value };
  if (m.mode === Mo.M.ABS) return { cls: m.value === 'absent' ? 'c-abs' : 'c-none', text: m.value === 'absent' ? 'A' : '✓' };
  return { cls: 'c-' + m.mode.toLowerCase(), text: { Pos: '+', Neg: '−', Part: 'P' }[m.mode] };
}

function dayView(code) {
  const c = cls();
  const body = h('div', { class: 'dayview' });
  const draw = () => {
    body.textContent = '';
    const s = Mo.student(S.doc, c, code) || { code, name: '' };
    const title = $('modal').querySelector('.modal-title');
    if (title) title.textContent = `${s.name || code}${s.name ? ' · ' + code : ''}`;
    const marks = Mo.marksOf(S.doc, c, today()).filter((m) => m.code === code && m.mode !== Mo.M.NOTE);
    const absent = Mo.absentCodes(S.doc, c, today()).has(code);
    const nameIn = h('input', { class: 'pinput', value: s.name || '', placeholder: 'Name used (blank shows the code)' });
    body.append(
      h('div', { class: 'dv-row' }, h('label', { text: 'Name used' }), nameIn,
        h('button', { class: 'tbtn', text: 'Save name', onclick: async () => {
          const st = Mo.student(S.doc, c, code);
          if (!st) return;
          st.name = nameIn.value.trim(); st.updatedAt = Mo.nowIso();
          await save(); renderAll(); toast('Name saved'); draw();
        } })),
      h('div', { class: 'dv-row' },
        h('span', { class: 'dv-state' }, chip(absent ? { cls: 'c-abs', text: 'A' } : { cls: 'c-none', text: '✓' }), absent ? ' Absent today' : ' Present today'),
        h('button', { class: 'tbtn', text: absent ? 'Mark present' : 'Mark absent', onclick: async () => { await setAbsent(code, !absent); draw(); } })),
      h('h3', { text: `Today, ${fmtDate(today())}` }),
      ...(marks.length ? [] : [h('p', { class: 'muted', text: 'No marks yet today.' })]),
      h('ul', { class: 'dv-list' }, marks.map((m) => h('li', {},
        chip(markChip(m)),
        h('span', { class: 'dv-label', text: markLabel(m) }),
        h('span', { class: 'dv-time', text: new Date(m.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }),
        m.mode === Mo.M.ABS ? null : h('button', { class: 'tbtn', text: 'Change', onclick: () => changeMark(m, draw) }),
        m.mode === Mo.M.ABS ? null : h('button', { class: 'tbtn danger', text: 'Delete', onclick: async () => {
          if (await confirmBox('Delete this mark?', markLabel(m), 'Delete', true)) { await editMark(m, { deleted: true }); draw(); }
        } })))),
    );
    const note = Mo.noteMark(S.doc, c, today(), code);
    const ta = h('textarea', { class: 'pnote', rows: 3, placeholder: 'Free note for today' });
    ta.value = note ? note.note : '';
    body.append(h('h3', { text: 'Note' }), ta, h('button', { class: 'tbtn primary', text: 'Save note', onclick: async () => {
      const text = ta.value.trim();
      if (note) await editMark(note, { note: text, deleted: !text });
      else if (text) await addMark(newMark(Mo.M.NOTE, code, { note: text }));
      toast('Note saved'); draw();
    } }));
  };
  modal(code, body);
  draw();
}

function changeMark(m, after) {
  if (m.mode === Mo.M.W) {
    sheet('Change worksheet mark', null, W_LEVELS.map((v) => ({
      label: W_LABEL[v], letter: v, cls: 'c-w' + v, current: m.value === v, onClick: async () => { await editMark(m, { value: v }); after(); },
    })), { levels: true });
  } else {
    const letter = { Pos: '+', Neg: '−', Part: 'P' }[m.mode];
    sheet(`Change ${MODE_NAME[m.mode].toLowerCase()} reason`, null, (S.doc.reasons[m.mode] || []).map((r) => ({
      label: r, letter, cls: 'c-' + m.mode.toLowerCase(), current: m.reason === r, onClick: async () => { await editMark(m, { reason: r }); after(); },
    })));
  }
}

// ---------- day summary, attendance history, picker ----------

function seatOrder(c, chart) {
  const out = [];
  if (chart) for (const t of chart.tables) for (const code of t.seats) if (code) out.push(code);
  for (const s of Mo.activeRoster(S.doc, c)) if (!out.includes(s.code)) out.push(s.code);
  return out;
}

function daySummary() {
  const c = cls(), d = today();
  const tally = Mo.dayTally(S.doc, c, d);
  const codes = seatOrder(c, currentChart());
  const absent = Mo.absentCodes(S.doc, c, d);
  const roll = Mo.rollTaken(S.doc, c, d);
  const lesson = Mo.lessonFor(S.doc, c, d);
  const tb = h('table', { class: 'grid-table' },
    h('thead', {}, h('tr', {}, ['Student', 'Worksheet', '+', '−', 'P', 'Attendance'].map((x) => h('th', { text: x })))),
    h('tbody', {}, codes.map((code) => {
      const e = tally[code] || {};
      const cell = (ch) => h('td', {}, ch ? chip(ch) : '');
      return h('tr', { class: absent.has(code) ? 'row-abs' : '' },
        h('td', { class: 'who', text: nameOf(code) }),
        cell(e.W != null ? { cls: 'c-w' + e.W + (e.Wcarried ? ' carried' : ''), text: e.W } : null),
        cell(e.Pos ? { cls: 'c-pos', text: '+' + (e.Pos > 1 ? e.Pos : '') } : null),
        cell(e.Neg ? { cls: 'c-neg', text: '−' + (e.Neg > 1 ? e.Neg : '') } : null),
        cell(e.Part ? { cls: 'c-part', text: 'P' + (e.Part > 1 ? e.Part : '') } : null),
        cell(absent.has(code) ? { cls: 'c-abs', text: 'A' } : (roll ? { cls: 'c-none', text: '✓' } : null)));
    })));
  const n = codes.length;
  const carried = codes.some((code) => (tally[code] || {}).Wcarried);
  modal(`Day summary · ${Mo.classLabel(S.doc, c)}`, h('div', {},
    h('p', { class: 'muted', text: `${fmtDate(d)}${lesson ? ' · ' + lesson : ''} · ` +
      (roll ? `roll taken: ${n - absent.size} present, ${absent.size} absent` : 'no roll yet (no marks today)') }),
    carried ? h('p', { class: 'muted carried-key' }, chip({ cls: 'c-w3 carried', text: '3' }), ' dashed with a dot: carried over from an earlier day of this lesson, not changed today') : null,
    h('div', { class: 'table-wrap' }, tb)));
}

function history() {
  const c = cls();
  const rows = Mo.attendanceHistory(S.doc, c);
  const codes = seatOrder(c, currentChart());
  const tb = h('table', { class: 'grid-table history' },
    h('thead', {}, h('tr', {}, h('th', { class: 'sticky', text: 'Date' }), codes.map((code) => h('th', { class: 'vert' }, h('span', { text: nameOf(code) }))), h('th', { text: 'Absent' }))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('td', { class: 'sticky who', text: fmtDate(r.date) }),
      codes.map((code) => r.absent.has(code) ? h('td', { class: 'abs-cell', text: 'A' }) : h('td', { class: 'pres-cell', text: '·' })),
      h('td', { text: String([...r.absent].filter((x) => codes.includes(x)).length) })))));
  modal(`Attendance · ${Mo.classLabel(S.doc, c)}`, h('div', {},
    h('p', { class: 'muted', text: rows.length ? `${rows.length} day(s) with roll. A = absent (grey), · = present. A day counts once any mark is recorded or Attendance mode is opened.` : 'No roll recorded yet for this block.' }),
    h('div', { class: 'table-wrap' }, tb)));
}

function pickRandom() {
  const c = cls();
  const absent = Mo.absentCodes(S.doc, c, today());
  const active = new Set(Mo.activeRoster(S.doc, c).map((s) => s.code));
  const ch = currentChart();
  let pool = ch ? [...Mo.seatedCodes(ch)] : [];
  if (!pool.length) pool = [...active];
  pool = pool.filter((x) => active.has(x) && !absent.has(x));
  if (!pool.length) return toast('No one present to pick');
  const recent = S.recentPicks[c] || [];
  const keep = Math.min(recent.length, Math.max(0, Math.floor(pool.length / 2)));
  const fresh = pool.filter((x) => !recent.slice(-keep).includes(x));
  const choice = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length ? fresh.length : pool.length))];
  S.recentPicks[c] = [...recent, choice].slice(-10);
  S.picked = choice;
  renderChart();
  toast(nameOf(choice), 4000, true);
  clearTimeout(pickRandom.t);
  pickRandom.t = setTimeout(() => { S.picked = null; renderChart(); }, 6000);
}

// ---------- lesson ----------

// A short list: today's planned lesson, the class's two most recent lessons (to continue one into a
// new day), the next planned ones, then "Something else…" to type a name. From a Worksheet tap,
// `after` opens that student's menu once a lesson is picked; Cancel records nothing.
function lessonMenu(after) {
  const c = cls(), d = today();
  const cur = Mo.lessonFor(S.doc, c, d);
  const planned = Mo.plannedLessons(S.doc, c, d);
  const items = [], seen = new Set();
  const add = (lesson, detail) => {
    const k = lesson.trim().toLowerCase();
    if (!seen.has(k)) { seen.add(k); items.push({ lesson, detail }); }
  };
  for (const p of planned) if (p.date === d) add(p.lesson, 'planned today');
  for (const r of Mo.recentLessons(S.doc, c, d)) add(r.lesson, 'last used ' + fmtDate(r.date));
  for (const p of planned) if (p.date > d) add(p.lesson, 'planned ' + fmtDate(p.date));
  const title = `Lesson for ${Mo.classLabel(S.doc, c)}, ${fmtDate(d)}`;
  sheet(title, after ? 'Worksheet marks go with a lesson. Pick one to continue or start.' : null, [
    ...items.map((x) => ({ label: x.lesson, detail: x.detail, cls: 'lesson-opt', current: x.lesson === cur, onClick: () => chooseLesson(x.lesson, after) })),
    { label: 'Something else…', cls: 'lesson-other', onClick: async () => {
      const v = await prompt(title, after ? '' : cur, 'Set');
      if (v === null || !v.trim()) return;
      chooseLesson(Mo.matchLesson(S.doc, c, d, v), after);
    } },
  ]);
}

async function chooseLesson(v, after) {
  await setLesson(v);
  if (after) after();
}

async function setLesson(v) {
  const c = cls(), d = today();
  const old = Mo.lessonFor(S.doc, c, d);
  if (!v || v === old) return;
  const t = Mo.nowIso();
  const p = S.doc.dayPlan.find((x) => x.class === c && x.date === d);
  if (p) Object.assign(p, { lesson: v, updatedAt: t, by: S.meta.device });
  else S.doc.dayPlan.push({ date: d, class: c, lesson: v, updatedAt: t, by: S.meta.device });
  // Today's marks in this block carry the day's lesson.
  for (const m of S.doc.marks) if (m.class === c && m.date === d && (m.lesson || '') === old) Object.assign(m, { lesson: v, edited: t });
  await save();
  renderAll();
}

// ---------- edit mode ----------

function enterEdit(chart, isNew = false) {
  S.draft = Mo.clone(chart);
  S.draftNew = isNew;
  S.draftFp = JSON.stringify(chart.tables);
  S.sel = null; S.selTable = null; S.trayPick = null;
  renderAll();
}

function exitEdit() {
  S.draft = null; S.draftNew = false; S.sel = null; S.selTable = null; S.trayPick = null;
  renderAll();
}

function editSeatTap(ti, si) {
  const seats = S.draft.tables[ti].seats;
  if (S.trayPick) {
    seats[si] = S.trayPick; // an occupant goes back to the tray (not seated)
    S.trayPick = null; S.sel = null; S.selTable = ti;
    return renderAll();
  }
  if (!S.sel) { S.sel = { t: ti, i: si }; S.selTable = ti; return renderAll(); }
  if (S.sel.t === ti && S.sel.i === si) { S.sel = null; return renderAll(); }
  swapSeats(S.sel, { t: ti, i: si });
  S.sel = null; S.selTable = ti;
  renderAll();
}

function swapSeats(a, b) {
  const A = S.draft.tables[a.t].seats, B = S.draft.tables[b.t].seats;
  const x = A[a.i]; A[a.i] = B[b.i]; B[b.i] = x;
}

function clampTable(t) {
  const r = S.doc.room;
  t.x = Math.max(40, Math.min(r.w - 40, Math.round(t.x / 5) * 5));
  t.y = Math.max(40, Math.min(r.h - 40, Math.round(t.y / 5) * 5));
}

function selTable() { return S.selTable != null ? S.draft.tables[S.selTable] : null; }

function editAction(kind) {
  const t = selTable();
  const need = () => { if (!t) { toast('Tap a table (its grip or a seat) first'); return false; } return true; };
  switch (kind) {
    case 'add': {
      const nt = { id: 't' + Date.now().toString(36), x: S.doc.room.w / 2, y: S.doc.room.h / 2, rot: 0, seats: [null, null] };
      S.draft.tables.push(nt); S.selTable = S.draft.tables.length - 1; S.sel = null;
      break;
    }
    case 'left': if (!need()) return; t.rot = Mo.normRot((t.rot || 0) - Mo.ROTATE_STEP); break;
    case 'right': if (!need()) return; t.rot = Mo.normRot((t.rot || 0) + Mo.ROTATE_STEP); break;
    case 'turn': if (!need()) return; t.rot = Mo.normRot((t.rot || 0) + 180); break;
    case 'seat+': if (!need()) return; if (t.seats.length >= 4) return toast('A table holds up to 4 seats'); t.seats.push(null); break;
    case 'seat-': if (!need()) return;
      if (t.seats.length <= 1) return toast('Last seat: delete the table instead');
      t.seats.pop(); S.sel = null; break;
    case 'del': if (!need()) return;
      S.draft.tables.splice(S.selTable, 1); S.selTable = null; S.sel = null; break;
  }
  renderAll();
}

async function finishEdit() {
  const changed = JSON.stringify(S.draft.tables) !== S.draftFp;
  if (!changed && !S.draftNew) return exitEdit();
  const c = cls();
  const saveOver = async () => {
    const t = Mo.nowIso();
    const list = S.doc.charts[c] ||= [];
    const i = list.findIndex((x) => x.id === S.draft.id);
    const ch = { ...S.draft, updatedAt: t, updatedBy: S.meta.device };
    if (i >= 0) list[i] = ch; else list.push(ch);
    S.meta.chartBy[c] = ch.id;
    await openedChart(ch.id);
    exitEdit(); await save(); toast(`Saved "${ch.name}"`);
  };
  const saveNew = async () => {
    const name = await prompt('Name for the new chart', S.draftNew ? S.draft.name : `${S.draft.name} 2`, 'Save');
    if (!name) return;
    const t = Mo.nowIso();
    const ch = { id: Mo.newId(S.meta.device), name, createdAt: t, updatedAt: t, updatedBy: S.meta.device, tables: Mo.clone(S.draft.tables) };
    (S.doc.charts[c] ||= []).push(ch);
    S.meta.chartBy[c] = ch.id;
    await openedChart(ch.id);
    exitEdit(); await save(); toast(`Saved as "${name}"`);
  };
  const buttons = S.draftNew
    ? [{ label: `Save "${S.draft.name}"`, cls: 'primary', onClick: saveOver }, { label: 'Discard', cls: 'danger', onClick: exitEdit }, { label: 'Keep editing' }]
    : [{ label: `Save (overwrite "${S.draft.name}")`, cls: 'primary', onClick: saveOver },
       { label: 'Save as new…', onClick: saveNew },
       { label: 'Discard changes', cls: 'danger', onClick: exitEdit },
       { label: 'Keep editing' }];
  sheet('Leave edit mode', null, buttons, { noCancel: true });
}

function chartMenu() {
  sheet(`Chart "${S.draft.name}"`, null, [
    { label: 'Rename…', onClick: renameChart },
    { label: 'Delete…', cls: 'danger', onClick: deleteChart },
    { label: 'New chart from…', onClick: newChartFrom },
  ]);
}

async function renameChart() {
  const name = await prompt('Rename chart', S.draft.name, 'Rename');
  if (!name) return;
  S.draft.name = name;
  const saved = (S.doc.charts[cls()] || []).find((x) => x.id === S.draft.id);
  if (saved) { saved.name = name; saved.updatedAt = Mo.nowIso(); saved.updatedBy = S.meta.device; await save(); }
  renderAll();
}

async function deleteChart() {
  const c = cls();
  if (S.draftNew) return exitEdit();
  if (Mo.liveCharts(S.doc, c).length <= 1) return toast("This is the class's last chart; it cannot be deleted", 3500);
  if (!await confirmBox(`Delete "${S.draft.name}"?`, 'Marks are kept; only the seating chart goes.', 'Delete', true)) return;
  const saved = (S.doc.charts[c] || []).find((x) => x.id === S.draft.id);
  Object.assign(saved, { deleted: true, updatedAt: Mo.nowIso(), updatedBy: S.meta.device });
  S.meta.chartBy[c] = Mo.liveCharts(S.doc, c)[0].id;
  exitEdit(); await save(); toast('Chart deleted');
}

function newChartFrom() {
  const buttons = [];
  for (const k of S.doc.classes) for (const ch of Mo.liveCharts(S.doc, k.id)) {
    buttons.push({ label: `${k.label} · ${ch.name}`, onClick: async () => {
      const name = await prompt(`New chart for ${Mo.classLabel(S.doc, cls())}, tables from "${ch.name}"`, ch.name + (k.id === cls() ? ' copy' : ''), 'Create');
      if (!name) return;
      const draft = Mo.chartFromTemplate(S.doc, cls(), ch, name, S.meta.device);
      enterEdit(draft, true);
      toast('Seats filled in class order. Adjust, then Done to save.', 3500);
    } });
  }
  sheet('New chart from…', "Copies the tables and fills them with this class's students.", buttons);
}

async function openedChart(id) {
  const c = cls();
  const lo = S.doc.lastOpened[c];
  if (!lo || lo.chart !== id) S.doc.lastOpened[c] = { chart: id, t: Mo.nowIso(), device: S.meta.device };
}

// ---------- settings ----------

function settings() {
  const body = h('div', { class: 'settings' });
  const linked = !!S.meta.dataId;
  body.append(
    h('h3', { text: 'Google Drive' }),
    h('p', { text: S.meta.demo ? 'Showing sample data (made-up codes). Connecting replaces it with your data file.'
      : linked ? `Data file linked${S.meta.inboxId ? ', inbox linked' : ', inbox not linked'}. Last sync: ${S.meta.lastSync ? new Date(S.meta.lastSync).toLocaleString() : 'never'}.`
      : 'Not linked yet.' }),
    ...(S.lastError ? [h('p', { class: 'warn', text: 'Last problem: ' + S.lastError })] : []),
    h('div', { class: 'btnrow' },
      h('button', { class: 'tbtn primary', 'data-signin': true, text: linked ? 'Reconnect' : 'Connect Google Drive', onclick: () => connect(false) }),
      h('button', { class: 'tbtn', 'data-signin': true, text: 'Pick the files again', onclick: () => connect(true) }),
      linked ? h('button', { class: 'tbtn', 'data-signin': true, text: 'Sync now', onclick: () => sync(true) }) : null),
    h('h3', { text: 'This device' }),
  );
  const dn = h('input', { class: 'pinput', value: S.meta.deviceName || '' });
  body.append(h('div', { class: 'dv-row' }, dn, h('button', { class: 'tbtn', text: 'Save', onclick: async () => {
    S.meta.deviceName = dn.value.trim() || S.meta.deviceName; await save(false); toast('Saved');
  } })), ...controlsChoice(), h('p', { class: 'muted', text: `Device id ${S.meta.device} · version ${VERSION}` }));

  body.append(h('h3', { text: 'Reason lists (one per line)' }));
  const tas = {};
  for (const k of ['Pos', 'Neg', 'Part']) {
    tas[k] = h('textarea', { class: 'pnote', rows: 5 });
    tas[k].value = (S.doc.reasons[k] || []).join('\n');
    body.append(h('label', { class: 'lbl', text: MODE_NAME[k] }), tas[k]);
  }
  body.append(h('button', { class: 'tbtn primary', text: 'Save lists', onclick: async () => {
    for (const k of ['Pos', 'Neg', 'Part']) S.doc.reasons[k] = tas[k].value.split('\n').map((x) => x.trim()).filter(Boolean);
    S.doc.reasons.updatedAt = Mo.nowIso();
    await save(); toast('Reason lists saved');
  } }));

  body.append(h('h3', { text: 'Backup' }), h('button', { class: 'tbtn', text: 'Download a copy of the data', onclick: () => {
    const blob = new Blob([JSON.stringify(S.doc, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `room-chart-backup-${today()}.json` });
    document.body.append(a); a.click(); a.remove();
  } }));
  modal('Settings', body);
}

function controlsChoice() {
  const row = h('div', { class: 'btnrow' });
  const draw = () => {
    row.textContent = '';
    for (const [v, label] of CONTROLS) {
      row.append(h('button', { class: 'tbtn', 'data-controls': v, 'aria-pressed': (S.meta.controls || 'auto') === v ? 'true' : 'false', text: label,
        onclick: async () => { S.meta.controls = v; applyLayout(); draw(); await save(false); } }));
    }
  };
  draw();
  return [h('label', { class: 'lbl', text: 'Controls' }), row,
    h('p', { class: 'muted', text: 'Automatic: on top when the screen is upright, in a column on the left when it is sideways.' })];
}

// ---------- screen layout ----------
// Controls on top (portrait) or in a column on the left (landscape), and a tab on their edge that
// hides and shows them. Both are kept per device. The chart refits itself whenever its space changes.
const CONTROLS = [['auto', 'Automatic'], ['top', 'Always on top'], ['side', 'Always on the left']];

function controlsOnSide() {
  const c = S.meta && S.meta.controls;
  if (c === 'top') return false;
  if (c === 'side') return true;
  return window.innerWidth > window.innerHeight;
}

function applyLayout() {
  const b = document.body;
  const side = controlsOnSide();
  const hidden = !!(S.meta && S.meta.ctlHidden) && !S.draft; // Edit mode always shows the controls
  b.classList.toggle('lay-side', side);
  b.classList.toggle('lay-top', !side);
  b.classList.toggle('ctl-hidden', hidden);
  renderTab();
}

function renderTab() {
  const tab = $('ctl-tab');
  if (!S.meta) return;
  const side = document.body.classList.contains('lay-side');
  const hidden = document.body.classList.contains('ctl-hidden');
  const m = MODES.find((x) => x.id === S.meta.mode) || MODES[0];
  tab.textContent = '';
  if (hidden) tab.append(h('span', { class: 'tmode m-' + m.id.toLowerCase(), text: m.letter }), h('span', { class: 'tdot ' + S.syncLevel }));
  tab.append(h('span', { class: 'tchev', text: side ? (hidden ? '▶' : '◀') : (hidden ? '▼' : '▲') }));
  tab.dataset.mode = m.id;
  tab.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  tab.setAttribute('aria-disabled', S.draft ? 'true' : 'false');
  tab.setAttribute('aria-label', hidden ? `Show the controls (mode: ${m.label})` : 'Hide the controls');
  tab.title = hidden ? `${m.label} · ${$('sync').textContent}` : 'Hide the controls';
}

async function toggleControls() {
  if (!S.meta) return;
  if (S.draft) return toast('The controls stay open while editing');
  S.meta.ctlHidden = !S.meta.ctlHidden;
  applyLayout();
  await save(false);
}

// ---------- Drive link and sync ----------

async function connect(forcePick) {
  try {
    if (!drive.configured()) return toast('Google setup is not finished yet', 3500);
    await drive.signIn(true, S.meta.email);
    signedIn();
    let data = forcePick ? [] : await drive.find(FILES.data);
    let inbox = forcePick ? [] : await drive.find(FILES.inbox);
    if (!data.length || !inbox.length) {
      const picked = await drive.pick();
      if (picked.some((f) => f.name === FILES.data)) data = picked.filter((f) => f.name === FILES.data);
      if (picked.some((f) => f.name === FILES.inbox)) inbox = picked.filter((f) => f.name === FILES.inbox);
      // After a pick the app can see the files; look them up by name as well.
      if (!data.length) data = await drive.find(FILES.data);
      if (!inbox.length) inbox = await drive.find(FILES.inbox);
    }
    if (!data.length) return toast(`${FILES.data} not picked`, 3500);
    const remote = Mo.normalize(await drive.read(data[0].id));
    if (S.meta.demo || !S.doc) S.doc = remote; // sample data never reaches the real file
    S.meta.demo = false;
    S.meta.dataId = data[0].id;
    S.meta.inboxId = inbox.length ? inbox[0].id : null;
    await learnAccount();
    if (!S.meta.cls || !S.doc.classes.some((c) => c.id === S.meta.cls)) S.meta.cls = (S.doc.classes[0] || {}).id;
    await save(false);
    closeModal(); hideWelcome();
    await sync(true);
    toast(S.meta.inboxId ? 'Linked: data file and inbox' : 'Linked: data file (inbox not found; pick it in Settings)', 4000);
  } catch (e) {
    S.lastError = e.message; renderSync();
    toast('Could not connect: ' + e.message, 4000);
  }
}

// ---------- quiet sign-in renewal ----------
// The access token runs out after about an hour and is lost when the app is closed. On a tap in its
// last ten minutes, or once it has run out, the app asks Google for a new one with no screen (the
// browser opens Google's window only during a tap). Only when Google needs the teacher does the
// pill ask for a sign-in. Taps stay on the device either way and sync once there is a token.
const RENEW_BEFORE = 10 * 60000;
let quietAfter = 0;         // no quiet request before this time (after a failed one)
let needsTeacher = false;   // Google answered that it needs the teacher: the pill asks for a sign-in

function signedIn() { needsTeacher = false; quietAfter = 0; }

function canRenew() {
  return !!(S.meta && !S.meta.demo && S.meta.dataId && navigator.onLine && drive.configured() && !drive.pending &&
    drive.expiresSoon(RENEW_BEFORE) && Date.now() >= quietAfter);
}

async function renewQuietly() {
  if (!canRenew()) return;
  quietAfter = Date.now() + 60000;
  try {
    await drive.signIn(false, S.meta.email);
    signedIn();
    await learnAccount();
    sync(false);
  } catch (e) {
    if (e.code === 'interaction') { needsTeacher = true; quietAfter = Date.now() + 10 * 60000; }
    if (!drive.hasToken()) { S.status = needsTeacher ? 'signin' : 'renew'; renderSync(); }
  }
}

// Every tap is a chance to renew; the pill and the Settings buttons sign in themselves.
function onGesture(e) {
  if (e.target && e.target.closest && e.target.closest('[data-signin]')) return;
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  renewQuietly();
}

// The account's address, kept as the hint so Google does not ask which account.
async function learnAccount() {
  if (S.meta.email || !drive.hasToken()) return;
  try { S.meta.email = await drive.account(); if (S.meta.email) await save(false); } catch (e) { /* the hint is optional */ }
}

let syncTimer = null;
function scheduleSync(ms) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync(false), ms);
}

async function sync(interactive) {
  if (S.syncing || !S.meta.dataId) return renderSync();
  if (!navigator.onLine) { S.status = 'offline'; return renderSync(); }
  S.syncing = true; renderSync();
  try {
    if (!drive.hasToken() && drive.pending) await drive.pending.catch(() => {});
    if (!drive.hasToken()) {
      if (!interactive) {
        S.status = needsTeacher ? 'signin' : 'renew';
        // Straight after a tap the browser still allows Google's window.
        if (navigator.userActivation && navigator.userActivation.isActive) setTimeout(renewQuietly, 0);
        return;
      }
      await drive.signIn(true, S.meta.email);
      signedIn();
      await learnAccount();
    }
    const remote = Mo.normalize(await drive.read(S.meta.dataId));
    let merged = Mo.merge(S.doc, remote);
    if (S.meta.inboxId) {
      try { merged = Mo.merge(merged, await drive.read(S.meta.inboxId)); S.meta.inboxOk = true; }
      catch (e) { S.meta.inboxOk = false; S.lastError = 'inbox: ' + e.message; }
    }
    if (Mo.fingerprint(merged) !== Mo.fingerprint(remote)) await drive.write(S.meta.dataId, merged);
    S.doc = Mo.merge(S.doc, merged); // keeps any tap made while this sync ran
    S.meta.remoteIndex = Mo.markIndex(merged);
    S.meta.lastSync = Mo.nowIso();
    S.status = 'ok';
    if (!S.lastError.startsWith('inbox')) S.lastError = '';
    await save(false);
  } catch (e) {
    if (e.code === 'interaction') needsTeacher = true;
    S.status = ['auth', 'interaction', 'popup'].includes(e.code) ? (needsTeacher ? 'signin' : 'renew') : 'error';
    S.lastError = e.message;
  } finally {
    S.syncing = false;
    renderAll();
  }
}

// ---------- rendering ----------

function renderSync() {
  const b = $('sync');
  const n = S.doc ? Mo.pendingCount(S.doc, S.meta.remoteIndex) : 0;
  let text, cls2 = '';
  if (S.meta.demo) { text = 'Sample data'; cls2 = 'warn'; }
  else if (!S.meta.dataId) { text = 'Not linked'; cls2 = 'warn'; }
  else if (S.syncing) text = 'Syncing…';
  else if (!navigator.onLine) { text = `Offline · ${n} waiting`; cls2 = 'warn'; }
  else if (S.status === 'signin') { text = `Tap to sign in · ${n} waiting`; cls2 = 'warn'; }
  else if (S.status === 'renew') { text = `Tap to sync · ${n} waiting`; cls2 = 'warn'; }
  else if (S.status === 'error') { text = `Sync problem · ${n} waiting`; cls2 = 'bad'; }
  else if (n > 0) { text = `${n} mark${n === 1 ? '' : 's'} waiting`; cls2 = 'warn'; }
  else text = 'Synced ✓';
  b.textContent = text;
  b.className = 'pill ' + cls2;
  b.title = text;
  S.syncLevel = cls2 || 'ok'; // the dot on the tab while the controls are hidden
  renderTab();
}

function renderTop() {
  const c = cls();
  const sc = $('cls');
  sc.textContent = '';
  for (const k of S.doc.classes) sc.append(h('option', { value: k.id, text: k.label, selected: k.id === c }));
  const ch = S.draft || currentChart();
  const sch = $('chart');
  sch.textContent = '';
  for (const x of Mo.liveCharts(S.doc, c)) sch.append(h('option', { value: x.id, text: x.name, selected: ch && x.id === ch.id }));
  if (S.draft && S.draftNew) sch.append(h('option', { value: S.draft.id, text: S.draft.name + ' (new)', selected: true }));
  sch.append(h('option', { value: '__new', text: '＋ New chart from…' }));
  sc.disabled = sch.disabled = !!S.draft;
  const vb = S.meta.view === 'board' ? 'Board' : 'Door';
  $('view').innerHTML = `${vb}<span class="long"> view</span>`;
  $('view').setAttribute('aria-pressed', S.meta.view === 'board' ? 'true' : 'false');
  const lesson = Mo.lessonFor(S.doc, c, today());
  $('lesson').textContent = lesson || 'Lesson: none';
  $('lesson').classList.toggle('blank', !lesson);
  $('date').textContent = fmtDate(today());
  $('edit').textContent = S.draft ? 'Done' : 'Edit';
  $('edit').classList.toggle('on', !!S.draft);
  document.body.classList.toggle('editing', !!S.draft);
  renderSync();
}

function renderModes() {
  const nav = $('modes');
  nav.textContent = '';
  for (const m of MODES) {
    nav.append(h('button', {
      class: `mode m-${m.id.toLowerCase()}` + (S.meta.mode === m.id ? ' on' : ''), 'aria-pressed': S.meta.mode === m.id ? 'true' : 'false',
      onclick: async () => { S.meta.mode = m.id; if (m.id === 'Att') await ensureRoll(); await save(m.id === 'Att'); renderAll(); },
    }, h('span', { class: 'mletter', text: m.letter }), h('span', { class: 'mlong', text: m.label }), h('span', { class: 'mshort', text: m.short })));
  }
  $('modes').hidden = !!S.draft;
}

function renderChart() {
  const c = cls();
  const chart = S.draft || currentChart();
  view.set({
    room: S.doc.room, chart, view: S.meta.view, names: namesFn(c),
    tally: S.draft ? {} : Mo.dayTally(S.doc, c, today()),
    editing: !!S.draft, selSeat: S.sel, selTable: S.selTable, picked: S.picked,
  });
}

function renderEdit() {
  $('editbar').hidden = !S.draft;
  $('tray').hidden = !S.draft;
  if (!S.draft) return;
  $('edit-name').textContent = S.draft.name + (S.draftNew ? ' (new, not saved)' : '');
  const seated = Mo.seatedCodes(S.draft);
  const loose = Mo.activeRoster(S.doc, cls()).filter((s) => !seated.has(s.code));
  const tray = $('tray');
  tray.textContent = '';
  tray.append(h('span', { class: 'tray-label', text: loose.length ? 'Not seated (tap, then tap a seat):' : 'Everyone is seated.' }));
  for (const s of loose) {
    tray.append(h('button', {
      class: 'traychip' + (S.trayPick === s.code ? ' on' : ''),
      onclick: () => { S.trayPick = S.trayPick === s.code ? null : s.code; S.sel = null; renderEdit(); },
      text: s.name || s.code,
    }));
  }
  const t = selTable();
  for (const id of ['e-left', 'e-right', 'e-turn', 'e-seat-plus', 'e-seat-minus', 'e-del']) $(id).disabled = !t;
}

function renderAll() {
  if (!S.doc) return;
  applyLayout(); renderTop(); renderModes(); renderEdit(); renderChart();
}

// ---------- welcome ----------

function showWelcome() {
  const w = $('welcome');
  w.hidden = false;
  $('w-connect').onclick = () => connect(false);
  $('w-sample').onclick = loadSample;
  $('w-note').textContent = drive.configured() ? '' : 'Google setup not finished yet: sample data only for now.';
}
function hideWelcome() { $('welcome').hidden = true; }

async function loadSample() {
  const res = await fetch('sample/sample-data.json');
  S.doc = Mo.normalize(await res.json());
  S.meta.demo = true;
  S.meta.cls = S.doc.classes[0].id;
  await save(false);
  hideWelcome();
  renderAll();
}

// ---------- boot ----------

function wire() {
  view = new ChartView($('svg'), {
    onSeatTap, onSeatLong, avoid: () => $('ctl-tab'),
    onBgTap: () => { if (S.draft) { S.sel = null; S.selTable = null; S.trayPick = null; renderAll(); } },
    onTableSelect: (t) => { S.selTable = t; S.sel = null; renderEdit(); renderChart(); },
    onTableDrag: (t, x, y) => { const tb = S.draft.tables[t]; tb.x = x; tb.y = y; clampTable(tb); renderChart(); },
    onTableDragEnd: () => renderAll(),
    onSeatDrop: (a, b) => { swapSeats(a, b); S.sel = null; S.selTable = b.t; renderAll(); },
  });
  $('cls').onchange = async (e) => {
    S.meta.cls = e.target.value; S.picked = null;
    if (S.meta.mode === 'Att') await ensureRoll();
    await save(false); view.fitted = false; renderAll();
  };
  $('chart').onchange = async (e) => {
    if (e.target.value === '__new') { renderTop(); return newChartFrom(); }
    S.meta.chartBy[cls()] = e.target.value;
    await openedChart(e.target.value);
    await save(); renderAll();
  };
  $('view').onclick = async () => { S.meta.view = S.meta.view === 'board' ? 'door' : 'board'; await save(false); renderAll(); };
  $('sync').onclick = () => { if (S.meta.demo || !S.meta.dataId) settings(); else sync(true); };
  $('lesson').onclick = () => lessonMenu(null);
  $('pick').onclick = pickRandom;
  $('summary').onclick = daySummary;
  $('history').onclick = history;
  $('settings').onclick = settings;
  $('fit').onclick = () => view.fit();
  $('ctl-tab').onclick = toggleControls;
  $('ctl-tab').addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', applyLayout); // rotation: the layout follows at once
  $('edit').onclick = () => {
    if (S.draft) return finishEdit();
    const ch = currentChart();
    if (ch) enterEdit(ch);
  };
  $('e-add').onclick = () => editAction('add');
  $('e-left').onclick = () => editAction('left');
  $('e-right').onclick = () => editAction('right');
  $('e-turn').onclick = () => editAction('turn');
  $('e-seat-plus').onclick = () => editAction('seat+');
  $('e-seat-minus').onclick = () => editAction('seat-');
  $('e-del').onclick = () => editAction('del');
  $('e-menu').onclick = chartMenu;
  document.addEventListener('pointerdown', () => { presses++; }, true);
  document.addEventListener('pointerup', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  $('sync').dataset.signin = '';
  $('w-connect').dataset.signin = '';
  guardClicks($('sheet')); guardClicks($('modal'));
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
  window.addEventListener('online', () => sync(false));
  window.addEventListener('offline', renderSync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderAll(); sync(false); } });
  setInterval(() => sync(false), 60000);
  setInterval(() => { if (S.doc && !S.draft) renderTop(); }, 60000); // the date rolls over at midnight
}

async function boot() {
  applyLayout();
  wire();
  S.meta = (await store.get('meta')) || {};
  if (!S.meta.device) {
    const kind = Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet';
    S.meta.device = `${kind}-${Math.random().toString(36).slice(2, 6)}`;
    S.meta.deviceName = kind;
  }
  S.meta.chartBy ||= {}; S.meta.remoteIndex ||= {};
  S.meta.view ||= 'door'; S.meta.mode ||= 'W'; S.meta.controls ||= 'auto';
  applyLayout();
  const doc = await store.get('doc');
  S.doc = doc ? Mo.normalize(doc) : null;
  store.persist();
  if (!S.doc) {
    const p = new URLSearchParams(location.search);
    if (p.get('testdrive')) { await connect(false); }
    else if (p.get('demo')) { await loadSample(); }
    else showWelcome();
  }
  if (S.doc) {
    if (!S.meta.cls || !S.doc.classes.some((c) => c.id === S.meta.cls)) S.meta.cls = (S.doc.classes[0] || {}).id;
    // Load Google's sign-in code now, so a tap can ask for a token at once.
    if (S.meta.dataId && !S.meta.demo && drive.configured()) drive.init().catch(() => {});
    renderAll();
    sync(false);
  }
  if ('serviceWorker' in navigator && !new URLSearchParams(location.search).get('nosw')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

window.__app = { S, sync, Mo, drive, get view() { return view; } }; // used by the test harness
boot();
