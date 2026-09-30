// node tests/model.test.mjs  -- merge rules and derived views, on made-up data.
import assert from 'node:assert/strict';
import * as Mo from '../js/model.js';
import { readFileSync } from 'node:fs';

const sample = JSON.parse(readFileSync(new URL('../sample/sample-data.json', import.meta.url)));
let n = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); n++; console.log('ok', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); }
};
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

// ---------- one worksheet mark and one note per key, across devices ----------
const T = (hm) => `2026-09-28T${hm}:00.000Z`;
const W = (id, value, tap, edit, over = {}) => mk(id, { mode: 'W', reason: '', value, t: T(tap), edited: T(edit || tap), device: id.split('-')[0], ...over });
const N = (id, note, tap, edit) => mk(id, { mode: 'Note', reason: '', note, t: T(tap), edited: T(edit || tap), device: id.split('-')[0] });
const live = (d, mode = 'W') => d.marks.filter((m) => m.mode === mode && m.code === '7301' && !m.deleted);
const withMarks = (...marks) => { const d = Mo.clone(sample); d.marks.push(...marks); return d; };

test('two devices mark one student; the later edit is shown and is the one a tap changes', () => {
  // As on 9/28: both marks in the file; the tablet corrected its own, earlier-tapped mark last.
  const d = withMarks(W('tablet-1', '1', '13:00', '13:10'), W('phone-1', '3', '13:05'));
  assert.equal(Mo.dayTally(d, 'B3', '2026-09-28')['7301'].W, '1', 'badge shows the latest edit');
  assert.equal(Mo.worksheetMark(d, 'B3', '2026-09-28', '7301', '').id, 'tablet-1');
  // The other way round: the phone's later tap is the latest edit.
  const e = withMarks(W('tablet-1', '2', '13:00'), W('phone-1', '3', '13:05'));
  assert.equal(Mo.worksheetMark(e, 'B3', '2026-09-28', '7301', '').id, 'phone-1', 'a tap edits the mark on screen');
  // Through a merge, either order.
  const a = withMarks(W('tablet-1', '1', '13:00', '13:10')), b = withMarks(W('phone-1', '3', '13:05'));
  for (const m of [Mo.merge(a, b), Mo.merge(b, a)]) assert.equal(Mo.dayTally(m, 'B3', '2026-09-28')['7301'].W, '1');
});

test('merge leaves one live worksheet mark, the same both ways round, and never undoes a later edit', () => {
  const a = withMarks(W('tablet-1', '2', '13:00')), b = withMarks(W('phone-1', '3', '13:05'));
  const m1 = Mo.merge(a, b), m2 = Mo.merge(b, a);
  assert.equal(Mo.fingerprint(m1), Mo.fingerprint(m2), 'merge(a, b) equals merge(b, a)');
  assert.deepEqual(live(m1).map((m) => m.id), ['phone-1']);
  const tomb = m1.marks.find((m) => m.id === 'tablet-1');
  assert.equal(tomb.deleted, true);
  assert.equal(tomb.edited, T('13:05'), "tombstone carries the keeper's edit time");
  assert.equal(Mo.fingerprint(Mo.merge(m1, a)), Mo.fingerprint(m1), 'a stale copy merged again changes nothing');
  // The tablet, not yet synced, edits its own mark after the phone's: that later edit wins everywhere.
  const a2 = withMarks(W('tablet-1', '4', '13:00', '13:20'));
  const r1 = Mo.merge(m1, a2), r2 = Mo.merge(a2, m1);
  assert.equal(Mo.fingerprint(r1), Mo.fingerprint(r2));
  assert.deepEqual(live(r1).map((m) => [m.id, m.value]), [['tablet-1', '4']]);
  // Three devices, any grouping and order.
  const c = withMarks(W('laptop-1', '5', '13:07'));
  const fps = [Mo.merge(Mo.merge(a, b), c), Mo.merge(a, Mo.merge(b, c)), Mo.merge(c, Mo.merge(b, a)), Mo.merge(Mo.merge(c, a), b)].map(Mo.fingerprint);
  assert.equal(new Set(fps).size, 1, 'same result whatever the order');
  assert.deepEqual(live(Mo.merge(Mo.merge(a, b), c)).map((m) => m.id), ['laptop-1']);
  // Same edit time on two devices: a stable choice, the same both ways.
  const t1 = withMarks(W('tablet-1', '2', '13:00')), t2 = withMarks(W('phone-1', '3', '13:00'));
  assert.equal(Mo.fingerprint(Mo.merge(t1, t2)), Mo.fingerprint(Mo.merge(t2, t1)));
  assert.equal(live(Mo.merge(t1, t2)).length, 1);
});

test('notes: one note per student and day; the latest edit wins, the same both ways round', () => {
  const a = withMarks(N('tablet-n', 'left early', '13:00', '13:30')), b = withMarks(N('phone-n', 'needs a pencil', '13:10'));
  const m1 = Mo.merge(a, b), m2 = Mo.merge(b, a);
  assert.equal(Mo.fingerprint(m1), Mo.fingerprint(m2));
  assert.deepEqual(live(m1, 'Note').map((m) => m.id), ['tablet-n']);
  const both = withMarks(N('tablet-n', 'left early', '13:00', '13:30'), N('phone-n', 'needs a pencil', '13:10'));
  assert.equal(Mo.noteMark(both, 'B3', '2026-09-28', '7301').id, 'tablet-n', 'the day view opens the latest note');
  assert.equal(Mo.dayTally(both, 'B3', '2026-09-28')['7301'].note, 'left early');
});

test('offline device marks a student who already has a mark: after sync the later edit wins', () => {
  const file = withMarks(W('tablet-1', '3', '13:00', '13:10'));
  const phone = withMarks(W('phone-1', '4', '13:15')); // offline: never saw the tablet's mark
  const s1 = Mo.merge(phone, file), s2 = Mo.merge(file, phone);
  assert.equal(Mo.fingerprint(s1), Mo.fingerprint(s2));
  assert.deepEqual(live(s1).map((m) => [m.id, m.value]), [['phone-1', '4']]);
  // The tablet corrects its mark after the phone's offline tap, before the phone is back.
  const file2 = withMarks(W('tablet-1', '2', '13:00', '13:20'));
  const s3 = Mo.merge(phone, file2);
  assert.deepEqual(live(s3).map((m) => [m.id, m.value]), [['tablet-1', '2']]);
  assert.equal(Mo.dayTally(s3, 'B3', '2026-09-28')['7301'].W, '2');
  // Both devices converge on the same document.
  const tabletNext = Mo.merge(file2, s3), phoneNext = Mo.merge(s3, phone);
  assert.equal(Mo.fingerprint(tabletNext), Mo.fingerprint(phoneNext));
});

test('guard: tombstones never remove a live mark; different lessons keep their own mark', () => {
  // The Grading Manager's tombstones carry a later edit time than the mark they left in place.
  const keeper = W('phone-1', '3', '13:05', '13:43');
  const tomb = W('tablet-1', '1', '13:00', '14:59', { deleted: true });
  const m = Mo.merge(withMarks(keeper), withMarks(tomb));
  assert.deepEqual(live(m).map((x) => x.id), ['phone-1']);
  const two = Mo.merge(withMarks(W('tablet-1', '2', '13:00', '13:00', { lesson: 'L1' })), withMarks(W('phone-1', '3', '13:05', '13:05', { lesson: 'L2' })));
  assert.equal(live(two).length, 2);
});

// ---------- a lesson that runs over several days keeps its worksheet completion ----------
const DT = (date, hm) => `${date}T${hm}:00.000Z`;
const WD = (id, date, value, lesson, hm = '13:00', over = {}) => mk(id, { mode: 'W', reason: '', value, lesson, date, t: DT(date, hm), edited: DT(date, hm), ...over });
const plan = (date, lesson, cls = 'B3') => ({ date, class: cls, lesson, updatedAt: DT(date, '12:00'), by: 'tablet-x' });
const docWith = (marks, dayPlan = []) => { const d = Mo.clone(sample); d.marks.push(...marks); d.dayPlan.push(...dayPlan); return d; };

test('carry-over: a continued lesson opens with each student\'s latest value, across one and two days', () => {
  const d = docWith([WD('a-1', '2026-09-28', '3', 'Day 1'), WD('a-2', '2026-09-28', '2', 'Day 1', '13:00', { code: '7302' })],
    [plan('2026-09-28', 'Day 1'), plan('2026-09-29', 'Day 1'), plan('2026-09-30', 'Day 1')]);
  // One day later.
  const t1 = Mo.dayTally(d, 'B3', '2026-09-29');
  assert.deepEqual([t1['7301'].W, t1['7301'].Wcarried, t1['7301'].Wfrom], ['3', true, '2026-09-28']);
  assert.equal(Mo.worksheetMark(d, 'B3', '2026-09-29', '7301', 'Day 1'), undefined, 'no mark of its own today');
  assert.equal(Mo.worksheetCarry(d, 'B3', '2026-09-29', '7301', 'Day 1').id, 'a-1');
  // 7301 moves to 5 on 9/29; 7302 is not touched. On 9/30 each opens at the latest value.
  d.marks.push(WD('b-1', '2026-09-29', '5', 'Day 1'));
  const t2 = Mo.dayTally(d, 'B3', '2026-09-30');
  assert.deepEqual([t2['7301'].W, t2['7301'].Wfrom], ['5', '2026-09-29']);
  assert.deepEqual([t2['7302'].W, t2['7302'].Wcarried, t2['7302'].Wfrom], ['2', true, '2026-09-28'], 'two days on');
  // Today's own mark is shown unflagged.
  const t3 = Mo.dayTally(d, 'B3', '2026-09-29');
  assert.deepEqual([t3['7301'].W, !!t3['7301'].Wcarried], ['5', false]);
});

test('carry-over: a change on a new day is a new dated mark; the earlier day\'s mark is left alone', () => {
  const first = WD('tablet-1', '2026-09-28', '3', 'Day 1');
  const tablet = docWith([first], [plan('2026-09-28', 'Day 1'), plan('2026-09-29', 'Day 1')]);
  const before = JSON.stringify(first);
  // What the worksheet menu does on 9/29: no mark today, the carried value is the current one, a pick adds a mark dated today.
  assert.equal(Mo.worksheetMark(tablet, 'B3', '2026-09-29', '7301', 'Day 1'), undefined);
  assert.equal(Mo.worksheetCarry(tablet, 'B3', '2026-09-29', '7301', 'Day 1').value, '3');
  tablet.marks.push(WD('tablet-2', '2026-09-29', '5', 'Day 1'));
  const m = Mo.merge(tablet, docWith([first], [plan('2026-09-28', 'Day 1')]));
  const w = m.marks.filter((x) => x.mode === 'W' && x.code === '7301' && !x.deleted).map((x) => [x.date, x.value]);
  assert.deepEqual(w, [['2026-09-28', '3'], ['2026-09-29', '5']], 'both days kept: one mark per day per lesson');
  assert.equal(JSON.stringify(m.marks.find((x) => x.id === 'tablet-1')), before, 'the 9/28 mark is unchanged');
  assert.equal(Mo.dayTally(m, 'B3', '2026-09-28')['7301'].W, '3');
  assert.deepEqual([Mo.dayTally(m, 'B3', '2026-09-29')['7301'].W, !!Mo.dayTally(m, 'B3', '2026-09-29')['7301'].Wcarried], ['5', false]);
  assert.equal(Mo.dayTally(m, 'B3', '2026-09-30')['7301'], undefined, 'no lesson set on 9/30: nothing carries');
});

test('carry-over: blocks do not mix under the same lesson name', () => {
  const d = docWith([WD('a-1', '2026-09-28', '4', 'Day 1'), WD('a-2', '2026-09-28', '1', 'Day 1', '13:30', { class: 'B4' }),
    WD('a-3', '2026-09-28', '2', 'Day 1', '13:40', { class: 'B4', code: '7309' })],
  [plan('2026-09-29', 'Day 1'), plan('2026-09-29', 'Day 1', 'B4')]);
  const b3 = Mo.dayTally(d, 'B3', '2026-09-29'), b4 = Mo.dayTally(d, 'B4', '2026-09-29');
  assert.equal(b3['7301'].W, '4', "B3 carries B3's value, not B4's later one");
  assert.equal(b4['7301'].W, '1');
  assert.equal(b3['7309'], undefined, 'a B4 mark never shows in B3');
  assert.equal(Mo.worksheetCarry(d, 'B3', '2026-09-29', '7309', 'Day 1'), undefined);
});

test('carry-over: a blank-lesson mark never carries (a named one does)', () => {
  const d = docWith([WD('a-1', '2026-09-27', '4', ''), WD('a-2', '2026-09-27', '2', 'Day 1', '13:00', { code: '7302' })],
    [plan('2026-09-27', ''), plan('2026-09-28', 'Day 1')]);
  const t = Mo.dayTally(d, 'B3', '2026-09-28');
  assert.equal(t['7301'], undefined, 'the blank-lesson 4 does not carry');
  assert.equal(t['7302'].W, '2');
  assert.equal(Mo.worksheetCarry(d, 'B3', '2026-09-28', '7301', ''), undefined);
  assert.equal(Mo.dayTally(docWith([WD('a-1', '2026-09-27', '4', '')]), 'B3', '2026-09-28')['7301'], undefined, 'no lesson today either');
});

test('recent lessons: at most two, newest first, today and other blocks left out', () => {
  const d = docWith([WD('a-1', '2026-09-24', '3', 'Day 1'), WD('a-2', '2026-09-25', '3', 'Day 1'), WD('a-3', '2026-09-26', '4', 'Day 2'),
    WD('a-4', '2026-09-29', '5', 'Day 4'), WD('a-5', '2026-09-28', '2', 'B4 only', '13:00', { class: 'B4' }),
    WD('a-6', '2026-09-28', '2', 'Deleted', '13:00', { deleted: true }), WD('a-7', '2026-09-28', '1', '')],
  [plan('2026-09-27', 'Day 3'), plan('2026-09-29', 'Day 4'), plan('2026-09-30', 'Day 5')]);
  assert.deepEqual(Mo.recentLessons(d, 'B3', '2026-09-29'), [{ lesson: 'Day 3', date: '2026-09-27' }, { lesson: 'Day 2', date: '2026-09-26' }]);
  assert.deepEqual(Mo.recentLessons(d, 'B3', '2026-09-30').map((x) => x.lesson), ['Day 4', 'Day 3'], 'the next day, yesterday\'s lesson leads');
  assert.deepEqual(Mo.recentLessons(d, 'B3', '2026-09-25'), [{ lesson: 'Day 1', date: '2026-09-24' }], 'a lesson counts once, at its latest date');
});

test('planned lessons: today and later only, earliest first, at most three', () => {
  const d = docWith([], [plan('2026-09-28', 'Day 3'), plan('2026-09-29', 'Day 4'), plan('2026-10-02', 'Day 7'), plan('2026-09-30', 'Day 5'),
    plan('2026-10-01', 'Day 6'), plan('2026-09-30', 'Other block', 'B4'), plan('2026-10-05', '')]);
  assert.deepEqual(Mo.plannedLessons(d, 'B3', '2026-09-29'), [{ lesson: 'Day 4', date: '2026-09-29' }, { lesson: 'Day 5', date: '2026-09-30' }, { lesson: 'Day 6', date: '2026-10-01' }]);
  assert.deepEqual(Mo.plannedLessons(d, 'B3', '2026-10-02'), [{ lesson: 'Day 7', date: '2026-10-02' }]);
  assert.deepEqual(Mo.plannedLessons(d, 'B3', '2026-10-03'), []);
});

test('a typed lesson is trimmed and matched without regard to capitals against the recent and planned lessons', () => {
  const d = docWith([WD('a-1', '2026-09-28', '3', 'Study guide')], [plan('2026-09-30', 'Day 2')]);
  assert.equal(Mo.matchLesson(d, 'B3', '2026-09-29', '  study GUIDE '), 'Study guide', 'recent label reused');
  assert.equal(Mo.matchLesson(d, 'B3', '2026-09-29', 'day 2'), 'Day 2', 'planned label reused');
  assert.equal(Mo.matchLesson(d, 'B3', '2026-09-29', '  Quiz 1  '), 'Quiz 1', 'a new name, trimmed');
  assert.equal(Mo.matchLesson(d, 'B3', '2026-09-29', '   '), '');
  // The reused label is the one that carries.
  d.dayPlan.push(plan('2026-09-29', Mo.matchLesson(d, 'B3', '2026-09-29', 'study guide')));
  assert.equal(Mo.dayTally(d, 'B3', '2026-09-29')['7301'].W, '3');
});

// Random runs. Without deletes, every merge order gives the same document. With deletes, one case
// depends on order: a device deletes the mark on screen while another still holds an older duplicate
// it has not synced; only live marks compete (ruling 1), so that duplicate may or may not come back
// depending on which devices synced first. merge(a, b) still equals merge(b, a), and all devices
// agree after one more sync.
const orderDependentWithDeletes = { runs: 0, of: 0 };
test('random runs: three devices tap, change, delete and sync in any order; one document, one live mark per key', () => {
  let seed = 7;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  const codes = ['7301', '7302', '7303'];
  for (let run = 0; run < 600; run++) {
    const deletes = run % 2 === 1;
    let clock = 0;
    const now = () => `2026-09-28T13:${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock++ % 60).padStart(2, '0')}.000Z`;
    const devs = ['tablet', 'phone', 'laptop'].map((name) => ({ name, doc: Mo.clone(sample), n: 0 }));
    for (let step = 0; step < 14; step++) {
      const d = devs[rnd(3)], code = codes[rnd(3)];
      let op = rnd(5);
      if (op === 3 && !deletes) op = 0;
      if (op < 3) { // tap a level: change the mark on screen, or make one
        const w = Mo.worksheetMark(d.doc, 'B3', '2026-09-28', code, '');
        const t = now();
        if (w) Object.assign(w, { value: String(rnd(6)), edited: t, device: d.name });
        else d.doc.marks.push(mk(`${d.name}-${d.n++}`, { mode: 'W', reason: '', code, value: String(rnd(6)), t, edited: t, device: d.name }));
      } else if (op === 3) { // delete the mark on screen
        const w = Mo.worksheetMark(d.doc, 'B3', '2026-09-28', code, '');
        if (w) Object.assign(w, { deleted: true, edited: now() });
      } else { // sync with another device
        const o = devs[rnd(3)];
        const m = Mo.merge(d.doc, o.doc);
        d.doc = Mo.clone(m); o.doc = Mo.clone(m);
      }
    }
    const [a, b, c] = devs.map((x) => x.doc);
    const orders = [Mo.merge(Mo.merge(a, b), c), Mo.merge(Mo.merge(b, a), c), Mo.merge(a, Mo.merge(b, c)),
      Mo.merge(Mo.merge(c, b), a), Mo.merge(b, Mo.merge(c, a)), Mo.merge(Mo.merge(a, c), b)];
    for (const [x, y] of [[a, b], [b, c], [a, c]]) assert.equal(Mo.fingerprint(Mo.merge(x, y)), Mo.fingerprint(Mo.merge(y, x)), `run ${run}: merge(a, b) differs from merge(b, a)`);
    const distinct = new Set(orders.map(Mo.fingerprint)).size;
    if (!deletes) assert.equal(distinct, 1, `run ${run}: merge order changed the result`);
    else {
      orderDependentWithDeletes.of++;
      if (distinct > 1) orderDependentWithDeletes.runs++;
      const next = orders.map((o) => Mo.fingerprint(orders.reduce((acc, p) => Mo.merge(acc, p), o)));
      assert.equal(new Set(next).size, 1, `run ${run}: devices do not agree after one more sync`);
    }
    for (const o of orders) for (const code of codes) assert.ok(o.marks.filter((m) => m.mode === 'W' && m.code === code && !m.deleted).length <= 1, `run ${run}: two live marks`);
    if (deletes) continue;
    for (const code of codes) {
      const l = orders[0].marks.filter((m) => m.mode === 'W' && m.code === code && !m.deleted);
      assert.ok(l.length <= 1, `run ${run}: ${l.length} live marks for one student`);
      // The mark shown is the latest edit among the live marks any device held.
      const seen = devs.flatMap((x) => x.doc.marks).filter((m) => m.mode === 'W' && m.code === code);
      const lastLive = seen.filter((m) => !m.deleted).sort((x, y) => x.edited.localeCompare(y.edited)).pop();
      const lastAny = seen.slice().sort((x, y) => x.edited.localeCompare(y.edited)).pop();
      if (l.length && lastAny && !lastAny.deleted) assert.equal(l[0].edited, lastLive.edited, `run ${run}: a later edit was undone`);
    }
  }
});

console.log(`(runs with deletes where the merge order mattered before one more sync: ${orderDependentWithDeletes.runs} of ${orderDependentWithDeletes.of})`);
console.log(`\n${n} tests passed${failed ? `, ${failed} FAILED` : ''}`);
if (failed) process.exitCode = 1;
