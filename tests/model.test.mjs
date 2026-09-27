// node tests/model.test.mjs  -- merge rules and derived views, on made-up data.
import assert from 'node:assert/strict';
import * as Mo from '../js/model.js';
import { readFileSync } from 'node:fs';

const sample = JSON.parse(readFileSync(new URL('../sample/sample-data.json', import.meta.url)));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const mk = (id, over = {}) => ({ id, t: '2026-09-28T13:00:00.000Z', edited: '2026-09-28T13:00:00.000Z', date: '2026-09-28', class: 'B3', code: '7301', lesson: '', mode: 'Pos', value: '', reason: 'on task', note: '', device: 'a', ...over });

test('sample: every active code once per chart', () => {
  for (const c of sample.classes) for (const ch of sample.charts[c.id]) {
    const r = Mo.checkChart(sample, c.id, ch);
    assert.ok(r.ok, `${c.id} ${ch.name} ${JSON.stringify(r)}`);
  }
});

test('marks from two devices merge by id, nothing lost', () => {
  const a = Mo.clone(sample), b = Mo.clone(sample);
  a.marks.push(mk('a-1'), mk('a-2'));
  b.marks.push(mk('b-1'));
  const m1 = Mo.merge(a, b), m2 = Mo.merge(b, a);
  assert.equal(m1.marks.length, 3);
  assert.equal(Mo.fingerprint(m1), Mo.fingerprint(m2));
});

test('an edited mark wins over the older copy', () => {
  const a = Mo.clone(sample), b = Mo.clone(sample);
  a.marks.push(mk('x', { mode: 'W', value: '2' }));
  b.marks.push(mk('x', { mode: 'W', value: '3', edited: '2026-09-28T13:05:00.000Z' }));
  assert.equal(Mo.merge(a, b).marks.find((m) => m.id === 'x').value, '3');
  assert.equal(Mo.merge(b, a).marks.find((m) => m.id === 'x').value, '3');
});

test('absent and undo on two devices: latest edit decides', () => {
  const a = Mo.clone(sample), b = Mo.clone(sample);
  a.marks.push(mk('p-abs', { mode: 'Abs', value: 'absent', t: '2026-09-28T13:01:00.000Z', edited: '2026-09-28T13:01:00.000Z' }));
  b.marks.push(mk('t-pres', { mode: 'Abs', value: 'present', t: '2026-09-28T13:02:00.000Z', edited: '2026-09-28T13:02:00.000Z' }));
  const m = Mo.merge(a, b);
  assert.equal(Mo.absentCodes(m, 'B3', '2026-09-28').has('7301'), false);
  const a2 = Mo.clone(m);
  a2.marks.push(mk('p-abs2', { mode: 'Abs', value: 'absent', t: '2026-09-28T13:03:00.000Z', edited: '2026-09-28T13:03:00.000Z' }));
  assert.equal(Mo.absentCodes(Mo.merge(a2, b), 'B3', '2026-09-28').has('7301'), true);
});

test('later chart save wins per chart; other charts untouched', () => {
  const a = Mo.clone(sample), b = Mo.clone(sample);
  a.charts.B3[0].tables[0].rot = 45; a.charts.B3[0].updatedAt = '2026-09-28T10:00:00.000Z';
  b.charts.B3[0].tables[0].rot = 90; b.charts.B3[0].updatedAt = '2026-09-28T11:00:00.000Z';
  b.charts.B3[1].tables[0].rot = 15; b.charts.B3[1].updatedAt = '2026-09-28T09:00:00.000Z';
  const m = Mo.merge(a, b);
  assert.equal(m.charts.B3[0].tables[0].rot, 90);
  assert.equal(m.charts.B3[1].tables[0].rot, 15);
});

test('inbox merge: new chart and seeded name arrive; a later app nickname stays', () => {
  const app = Mo.clone(sample);
  app.roster.B3[0].name = 'Sam'; app.roster.B3[0].updatedAt = '2026-09-29T08:00:00.000Z';
  const inbox = { schema: Mo.SCHEMA, roster: { B3: [{ ...sample.roster.B3[0], name: 'Samuel', updatedAt: '2026-09-28T08:00:00.000Z' },
    { ...sample.roster.B3[1], name: 'Ana', updatedAt: '2026-09-28T08:00:00.000Z' }] },
    charts: { B3: [{ id: 'test-day', name: 'Test day', createdAt: '2026-09-28T08:00:00.000Z', updatedAt: '2026-09-28T08:00:00.000Z', tables: sample.charts.B3[0].tables }] },
    dayPlan: [{ date: '2026-09-28', class: 'B3', lesson: 'M8-U1-D13', updatedAt: '2026-09-28T08:00:00.000Z' }] };
  const m = Mo.merge(app, inbox);
  assert.equal(m.roster.B3.find((s) => s.code === sample.roster.B3[0].code).name, 'Sam');
  assert.equal(m.roster.B3.find((s) => s.code === sample.roster.B3[1].code).name, 'Ana');
  assert.equal(Mo.liveCharts(m, 'B3').length, 3);
  assert.equal(Mo.lessonFor(m, 'B3', '2026-09-28'), 'M8-U1-D13');
  assert.equal(m.marks.length, 0);
  assert.equal(Mo.fingerprint(Mo.merge(m, inbox)), Mo.fingerprint(m), 'merging the inbox twice changes nothing');
});

test('roll: none without marks; any mark or a roll entry counts', () => {
  const d = Mo.clone(sample);
  assert.equal(Mo.rollTaken(d, 'B3', '2026-09-28'), false);
  d.marks.push(mk('r1', { mode: 'Part', reason: 'board work' }));
  assert.equal(Mo.rollTaken(d, 'B3', '2026-09-28'), true);
  d.rolls.push({ id: 'roll1', date: '2026-09-29', class: 'B4', t: '2026-09-29T13:00:00.000Z', device: 'a' });
  assert.equal(Mo.rollTaken(d, 'B4', '2026-09-29'), true);
  const h = Mo.attendanceHistory(d, 'B3');
  assert.deepEqual(h.map((x) => x.date), ['2026-09-28']);
});

test('deleted mark syncs as a tombstone', () => {
  const a = Mo.clone(sample), b = Mo.clone(sample);
  a.marks.push(mk('d1')); b.marks.push(mk('d1', { deleted: true, edited: '2026-09-28T13:09:00.000Z' }));
  const m = Mo.merge(a, b);
  assert.equal(Mo.marksOf(m, 'B3', '2026-09-28').length, 0);
});

test('tally for badges', () => {
  const d = Mo.clone(sample);
  d.marks.push(mk('1'), mk('2'), mk('3', { mode: 'Neg', reason: 'phone' }), mk('4', { mode: 'W', value: '2' }));
  const t = Mo.dayTally(d, 'B3', '2026-09-28')['7301'];
  assert.deepEqual([t.Pos, t.Neg, t.Part, t.W, t.absent], [2, 1, 0, '2', false]);
});

test('seat centres: turned table puts seat 0 on the right', () => {
  const [s0, s1] = Mo.seatCenters({ x: 500, y: 100, rot: 180, seats: ['a', 'b'] });
  assert.ok(s0.x > s1.x);
  const [u0, u1] = Mo.seatCenters({ x: 500, y: 100, rot: 0, seats: ['a', 'b'] });
  assert.ok(u0.x < u1.x);
});

test('new chart from a template fills in class order', () => {
  const ch = Mo.chartFromTemplate(sample, 'B4', sample.charts.B1[0], 'From B1', 'dev');
  const r = Mo.checkChart(sample, 'B4', ch);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(ch.tables.length, sample.charts.B1[0].tables.length);
});

console.log(`\n${n} tests passed`);
