// Data document, merge rules and derived views. No DOM here, so it also runs under Node for tests.

export const SCHEMA = 'room-chart/1';

// Room geometry in door view (board at the top). Units are arbitrary; the chart is scaled to fit.
export const ROOM = { w: 1060, h: 680 };
export const SEAT_W = 150;
export const SEAT_H = 90;
export const ROTATE_STEP = 15;

// Mark modes stored in the log.
export const M = { W: 'W', POS: 'Pos', NEG: 'Neg', PART: 'Part', ABS: 'Abs', NOTE: 'Note' };

export const DEFAULT_REASONS = {
  Pos: ['on task', 'helped a peer', 'good question', 'strong effort'],
  Neg: ['off task', 'chatting', 'phone', 'no Chromebook / materials', 'disrupting'],
  Part: ['answered in class', 'board work', 'group work'],
  updatedAt: '',
};

export function emptyDoc() {
  return {
    schema: SCHEMA,
    room: { ...ROOM },
    classes: [],
    roster: {},
    charts: {},
    dayPlan: [],
    reasons: structuredCloneSafe(DEFAULT_REASONS),
    marks: [],
    rolls: [],
    lastOpened: {},
  };
}

function structuredCloneSafe(x) { return JSON.parse(JSON.stringify(x)); }
export const clone = structuredCloneSafe;

export function nowIso() { return new Date().toISOString(); }

// Local calendar date of the device, YYYY-MM-DD.
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newId(device) {
  const r = Math.random().toString(36).slice(2, 8);
  return `${device || 'dev'}-${Date.now().toString(36)}-${r}`;
}

// Fill in missing top-level keys so older or partial files load.
export function normalize(doc) {
  const d = Object.assign(emptyDoc(), doc || {});
  d.room = Object.assign({ ...ROOM }, d.room || {});
  d.classes = Array.isArray(d.classes) ? d.classes : [];
  d.roster = d.roster || {};
  d.charts = d.charts || {};
  d.dayPlan = Array.isArray(d.dayPlan) ? d.dayPlan : [];
  d.reasons = Object.assign(structuredCloneSafe(DEFAULT_REASONS), d.reasons || {});
  d.marks = Array.isArray(d.marks) ? d.marks : [];
  d.rolls = Array.isArray(d.rolls) ? d.rolls : [];
  d.lastOpened = d.lastOpened || {};
  return d;
}

// ---------- merge ----------
// Every rule keeps the entry with the later timestamp; ties break on a stable string compare,
// so merge(a, b) and merge(b, a) give the same result.

function later(x, y, field) {
  if (!x) return y;
  if (!y) return x;
  const tx = x[field] || '', ty = y[field] || '';
  if (tx !== ty) return tx > ty ? x : y;
  const sx = JSON.stringify(x), sy = JSON.stringify(y);
  return sx >= sy ? x : y;
}

function mergeList(a, b, keyFn, field) {
  const map = new Map();
  for (const item of a || []) map.set(keyFn(item), item);
  for (const item of b || []) {
    const k = keyFn(item);
    map.set(k, later(map.get(k), item, field));
  }
  return [...map.values()];
}

function mergeKeyed(a, b, field) {
  const out = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) out[k] = later((a || {})[k], (b || {})[k], field);
  return out;
}

export function merge(a, b) {
  a = normalize(a); b = normalize(b);
  const out = emptyDoc();
  out.room = later(a.room, b.room, 'updatedAt');

  out.classes = mergeList(a.classes, b.classes, (c) => c.id, 'updatedAt');
  out.classes.sort((x, y) => (x.order ?? 99) - (y.order ?? 99) || x.id.localeCompare(y.id));

  const classIds = new Set([...Object.keys(a.roster), ...Object.keys(b.roster)]);
  for (const c of classIds) {
    const list = mergeList(a.roster[c], b.roster[c], (s) => s.code, 'updatedAt');
    list.sort((x, y) => (x.order ?? 999) - (y.order ?? 999) || x.code.localeCompare(y.code));
    out.roster[c] = list;
  }

  const chartClasses = new Set([...Object.keys(a.charts), ...Object.keys(b.charts)]);
  for (const c of chartClasses) {
    const list = mergeList(a.charts[c], b.charts[c], (ch) => ch.id, 'updatedAt');
    list.sort((x, y) => (x.createdAt || '').localeCompare(y.createdAt || '') || x.id.localeCompare(y.id));
    out.charts[c] = list;
  }

  out.dayPlan = mergeList(a.dayPlan, b.dayPlan, (p) => `${p.date}|${p.class}`, 'updatedAt');
  out.dayPlan.sort((x, y) => x.date.localeCompare(y.date) || x.class.localeCompare(y.class));

  out.reasons = later(a.reasons, b.reasons, 'updatedAt');
  out.marks = mergeList(a.marks, b.marks, (m) => m.id, 'edited');
  out.marks.sort((x, y) => (x.t || '').localeCompare(y.t || '') || x.id.localeCompare(y.id));
  out.rolls = mergeList(a.rolls, b.rolls, (r) => r.id, 't');
  out.rolls.sort((x, y) => (x.t || '').localeCompare(y.t || '') || x.id.localeCompare(y.id));
  out.lastOpened = mergeKeyed(a.lastOpened, b.lastOpened, 't');
  return out;
}

// Stable text form, used to tell whether a merge changed anything.
export function fingerprint(doc) {
  return JSON.stringify(normalize(doc));
}

// Marks present locally but not (in this edit) in the last remote copy that was read.
export function pendingCount(doc, remoteIndex) {
  let n = 0;
  for (const m of doc.marks) if ((remoteIndex || {})[m.id] !== m.edited) n++;
  return n;
}

export function markIndex(doc) {
  const idx = {};
  for (const m of normalize(doc).marks) idx[m.id] = m.edited;
  return idx;
}

// ---------- lookups ----------

export function classLabel(doc, cls) {
  const c = doc.classes.find((x) => x.id === cls);
  return c ? c.label : cls;
}

export function activeRoster(doc, cls) {
  return (doc.roster[cls] || []).filter((s) => s.active !== false);
}

export function student(doc, cls, code) {
  return (doc.roster[cls] || []).find((s) => s.code === code);
}

// Name shown on a card: the name used, or the code alone until names are seeded.
export function displayName(doc, cls, code) {
  const s = student(doc, cls, code);
  return s && s.name ? s.name : code;
}

export function liveCharts(doc, cls) {
  return (doc.charts[cls] || []).filter((c) => !c.deleted);
}

export function lessonFor(doc, cls, date) {
  const p = doc.dayPlan.find((x) => x.class === cls && x.date === date);
  return p ? p.lesson || '' : '';
}

export function marksOf(doc, cls, date) {
  return doc.marks.filter((m) => m.class === cls && m.date === date && !m.deleted);
}

// Absence for one student, date and block: the latest Absent entry by edit time decides.
export function absentCodes(doc, cls, date) {
  const latest = new Map();
  for (const m of marksOf(doc, cls, date)) {
    if (m.mode !== M.ABS) continue;
    const prev = latest.get(m.code);
    if (!prev || (m.edited || m.t) > (prev.edited || prev.t) ||
        ((m.edited || m.t) === (prev.edited || prev.t) && m.id > prev.id)) latest.set(m.code, m);
  }
  const out = new Set();
  for (const [code, m] of latest) if (m.value === 'absent') out.add(code);
  return out;
}

// Roll taken for a block and day: any mark of any kind, or Attendance mode opened (a roll entry).
export function rollTaken(doc, cls, date) {
  if (doc.rolls.some((r) => r.class === cls && r.date === date)) return true;
  return marksOf(doc, cls, date).length > 0;
}

// The worksheet mark: once per lesson per student per day.
export function worksheetMark(doc, cls, date, code, lesson) {
  return marksOf(doc, cls, date).find((m) => m.mode === M.W && m.code === code && (m.lesson || '') === (lesson || ''));
}

export function noteMark(doc, cls, date, code) {
  return marksOf(doc, cls, date).find((m) => m.mode === M.NOTE && m.code === code);
}

// Per-student tally for the badge and the day summary.
export function dayTally(doc, cls, date) {
  const lesson = lessonFor(doc, cls, date);
  const absent = absentCodes(doc, cls, date);
  const t = {};
  const get = (code) => (t[code] ||= { Pos: 0, Neg: 0, Part: 0, W: null, absent: false, note: '' });
  for (const m of marksOf(doc, cls, date)) {
    const e = get(m.code);
    if (m.mode === M.POS || m.mode === M.NEG || m.mode === M.PART) e[m.mode]++;
    else if (m.mode === M.W && (m.lesson || '') === lesson) e.W = m.value;
    else if (m.mode === M.W && e.W === null) e.W = m.value;
    else if (m.mode === M.NOTE) e.note = m.note || '';
  }
  for (const code of absent) get(code).absent = true;
  return t;
}

// Dates on which roll was taken for a block, newest first, with the absent set for each.
export function attendanceHistory(doc, cls) {
  const dates = new Set();
  for (const r of doc.rolls) if (r.class === cls) dates.add(r.date);
  for (const m of doc.marks) if (m.class === cls && !m.deleted) dates.add(m.date);
  return [...dates].sort().reverse().map((date) => ({ date, absent: absentCodes(doc, cls, date) }));
}

// ---------- charts ----------

// Seat centres of a table in door-view coordinates. Seat 0 is at the table's local left
// (the students' left when they face the way the table faces).
export function seatCenters(table) {
  const n = table.seats.length;
  const a = (table.rot || 0) * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const out = [];
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * SEAT_W, ly = 0;
    out.push({ x: table.x + lx * cos - ly * sin, y: table.y + lx * sin + ly * cos });
  }
  return out;
}

export function seatedCodes(chart) {
  const s = new Set();
  for (const t of chart.tables) for (const c of t.seats) if (c) s.add(c);
  return s;
}

export function normRot(r) {
  r = Math.round(r) % 360;
  return r < 0 ? r + 360 : r;
}

// A copy of another chart's tables, seats filled with this class's active students in class order.
export function chartFromTemplate(doc, cls, source, name, device) {
  const codes = activeRoster(doc, cls).map((s) => s.code);
  let i = 0;
  const tables = source.tables.map((t, ti) => ({
    id: `t${ti + 1}`, x: t.x, y: t.y, rot: t.rot || 0,
    seats: t.seats.map(() => (i < codes.length ? codes[i++] : null)),
  }));
  const t = nowIso();
  return { id: newId(device), name, createdAt: t, updatedAt: t, updatedBy: device, tables };
}

// Every active code appears exactly once; reports duplicates, missing and unknown codes.
export function checkChart(doc, cls, chart) {
  const active = new Set(activeRoster(doc, cls).map((s) => s.code));
  const seen = new Map();
  for (const t of chart.tables) for (const c of t.seats) if (c) seen.set(c, (seen.get(c) || 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([c]) => c);
  const missing = [...active].filter((c) => !seen.has(c));
  const unknown = [...seen.keys()].filter((c) => !active.has(c));
  return { ok: !dup.length && !missing.length && !unknown.length, seated: seen.size, dup, missing, unknown };
}
