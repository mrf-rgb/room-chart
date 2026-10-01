// The day summary and the attendance history list the class in roster order (the roster is kept in
// last-name order), whatever chart is open. Finger taps, phone and tablet.
//   S=<folder> node tests/daylist.mjs   (test server on 8123, fresh sample data in <folder>/drive1)
// The data file is changed first, so that roster order differs from seat order, code order and the
// order of the entries in the file: B3 gets new `order` numbers; one student has no seat in the chart
// that opens; one is inactive but still seated; one has no `order` number; one active student and the
// inactive one are marked absent today; one student has a worksheet mark; one has a (made-up) name
// used. Then, at each size:
// 1. Day summary: one row per active student, in roster order; the unseated student in their place;
//    the inactive one not listed; the one with no order number last; marks on the right row.
// 2. The roll line counts the students listed.
// 3. Another chart: the same rows in the same order.
// 4. History: the columns in the same order, and its Absent count for the students listed.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
const S = process.env.S;
const DIR = `${S}/drive1`;
const URL = 'http://localhost:8123/?nosw=1&testdrive=http://localhost:8123/api';
const SIZES = [[390, 844, 'phone'], [1280, 800, 'tablet']];
const results = []; const errors = [];
let tag = '';
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} [${tag}] ${name}${extra ? ' - ' + extra : ''}`);
const pristine = readFileSync(`${DIR}/class-tracker-data.json`, 'utf8');
const pos = (list, code) => list.indexOf(code) + 1;
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const d0 = new Date();
const TODAY = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
const seatsOf = (ch) => { const out = []; for (const t of ch.tables) for (const c of t.seats) if (c) out.push(c); return out; };
const NAME = 'Name-one';

function seed() {
  const d = JSON.parse(pristine);
  const now = new Date().toISOString();
  const roster = d.roster.B3, n = roster.length;
  // New order numbers by a fixed step through the list, then the entries reversed in the file.
  const step = [7, 5, 11, 13].find((k) => n % k !== 0);
  roster.forEach((s, i) => { s.order = ((i * step + 3) % n) + 1; s.updatedAt = now; });
  roster.reverse();
  const first = d.charts.B3.find((c) => c.id === d.lastOpened.B3.chart), other = d.charts.B3.find((c) => c !== first);
  const ranked = [...roster].sort((a, b) => a.order - b.order);
  const lastSeats = [seatsOf(first).pop(), seatsOf(other).pop()];
  const away = ranked[1], gone = ranked[4], named = ranked[6], loose = ranked[9], worked = ranked[12];
  named.name = NAME;                                                                          // a name used (made up): shown as on the seat
  const late = ranked.slice(14, 18).find((s) => !lastSeats.includes(s.code));
  for (const t of first.tables) t.seats = t.seats.map((c) => (c === loose.code ? null : c)); // no seat in the chart that opens
  gone.active = false;                                                                        // inactive, still seated
  delete late.order;                                                                          // no order number: comes last
  const mark = (k, code, mode, value, lesson = '') => ({ id: `seed-${k}`, t: now, date: TODAY, class: 'B3', code, lesson, mode, value, reason: '', note: '', device: 'tablet-seed', edited: now });
  d.dayPlan.push({ date: TODAY, class: 'B3', lesson: 'Lesson A', updatedAt: now, by: 'tablet-seed' });
  d.marks.push(mark(1, away.code, 'Abs', 'absent'), mark(2, gone.code, 'Abs', 'absent'), mark(3, worked.code, 'W', '4', 'Lesson A'));
  writeFileSync(`${DIR}/class-tracker-data.json`, JSON.stringify(d, null, 1));
  // What the lists should show: active students by order number (none: last), then by code.
  const want = roster.filter((s) => s.active !== false).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.code.localeCompare(b.code)).map((s) => s.code);
  return { want, first, other, away: away.code, gone: gone.code, named: named.code, loose: loose.code, late: late.code, worked: worked.code,
    byCode: [...want].sort(), inFile: roster.filter((s) => s.active !== false).map((s) => s.code) };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [VW, VH, t] of SIZES) {
  tag = t;
  const x = seed();
  const { want } = x;
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, isMobile: VW < 700 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${t}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${t}: ${m.text()}`); });
  await page.goto(URL); await page.waitForTimeout(1200);
  await page.selectOption('#cls', 'B3'); await page.waitForTimeout(300);

  const closeModal = async () => { await page.locator('.modal-head .tbtn').tap(); await page.waitForTimeout(200); };
  const codeOf = (label) => (label === NAME ? x.named : label); // the lists show the name used, or the code when there is none
  const day = async () => {
    await page.locator('#summary').tap(); await page.waitForTimeout(300);
    const got = await page.evaluate(() => ({
      head: [...document.querySelectorAll('.grid-table thead th')].map((e) => e.textContent),
      rows: [...document.querySelectorAll('.grid-table tbody tr')].map((r) => ({ who: r.querySelector('td.who').textContent, abs: r.classList.contains('row-abs'),
        chips: [...r.querySelectorAll('.chipx')].map((c) => c.className.replace('chipx ', '') + ':' + c.textContent) })),
      line: (document.querySelector('.modal-body p.muted') || {}).textContent || '' }));
    await closeModal();
    return { ...got, codes: got.rows.map((r) => codeOf(r.who)) };
  };
  const hist = async () => {
    await page.locator('#history').tap(); await page.waitForTimeout(300);
    const got = await page.evaluate(() => ({ cols: [...document.querySelectorAll('.history thead th.vert span')].map((e) => e.textContent),
      rows: [...document.querySelectorAll('.history tbody tr')].map((r) => ({ date: r.querySelector('td.who').textContent, n: r.lastElementChild.textContent, a: r.querySelectorAll('.abs-cell').length })) }));
    await closeModal();
    return { ...got, shown: got.cols, cols: got.cols.map(codeOf) };
  };
  const chartNow = () => page.evaluate(() => { const S = window.__app.S; return S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart; });

  try {
    // The sample data as changed: roster order is not seat order, code order or the order in the file.
    const differs = !same(want, seatsOf(x.first)) && !same(want, seatsOf(x.other)) && !same(want, x.byCode) && !same(want, x.inFile);
    const d1 = await day();
    check('Day summary: the rows follow roster order, not seat order', differs && same(d1.codes, want), `first rows ${d1.codes.slice(0, 4).map((c) => pos(want, c)).join(',')} by roster place`);
    check('every active student appears once', d1.codes.length === want.length && new Set(d1.codes).size === d1.codes.length && want.every((c) => d1.codes.includes(c)), `${d1.codes.length} rows for ${want.length} active`);
    check('a student with no seat in this chart appears in their roster place', pos(d1.codes, x.loose) === pos(want, x.loose) && pos(want, x.loose) < want.length, `row ${pos(d1.codes, x.loose)}, roster place ${pos(want, x.loose)}`);
    check('an inactive student, still seated in the chart, does not appear', seatsOf(x.first).includes(x.gone) && !d1.codes.includes(x.gone));
    check('a student with no order number comes last', d1.codes[d1.codes.length - 1] === x.late && seatsOf(x.first).pop() !== x.late, `row ${pos(d1.codes, x.late)} of ${d1.codes.length}`);
    const rowAt = (code) => d1.rows[pos(want, code) - 1] || { chips: [] };
    check("each student's marks are on their own row, in its roster place", rowAt(x.worked).who === x.worked && rowAt(x.worked).chips.includes('c-w4:4') && rowAt(x.away).who === x.away && rowAt(x.away).abs && rowAt(x.away).chips.includes('c-abs:A'),
      `${rowAt(x.worked).chips.join(' ')} / ${rowAt(x.away).chips.join(' ')}`);
    check('the roll line counts the students listed', d1.line.includes(`roll taken: ${want.length - 1} present, 1 absent`), d1.line);
    check('the columns are as before', d1.head.join('|') === 'Student|Worksheet|+|−|P|Attendance', d1.head.join('|'));
    await page.screenshot({ path: `${S}/shots/daylist-${t}-chart.png` });
    await page.locator('#summary').tap(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${S}/shots/daylist-${t}-day.png` });
    await closeModal();

    const h1 = await hist();
    check('History: the columns follow the same order', same(h1.cols, want), `${h1.cols.length} columns; first ${h1.cols.slice(0, 4).map((c) => pos(want, c)).join(',')} by roster place`);
    check("History: today's Absent count is for the students listed", h1.rows.length === 1 && h1.rows[0].n === '1' && h1.rows[0].a === 1, JSON.stringify(h1.rows));
    // Only the order changed: a student shows by the name used, exactly as on the seat.
    const onSeat = await page.evaluate((nm) => [...document.querySelectorAll('.labels text.name')].filter((e) => e.textContent === nm).length, NAME);
    const k = pos(want, x.named) - 1;
    check('each row and column shows the name used, exactly as on the seat, in its roster place', onSeat === 1 && (d1.rows[k] || {}).who === NAME && h1.shown[k] === NAME,
      `Day "${(d1.rows[k] || {}).who === NAME ? NAME : 'another student'}", History "${h1.shown[k] === NAME ? NAME : 'another student'}", on ${onSeat} seat`);
    await page.locator('#history').tap(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${S}/shots/daylist-${t}-history.png` });
    await closeModal();

    // Another chart: other seats, the same list.
    const before = await chartNow();
    await page.selectOption('#chart', x.other.id); await page.waitForTimeout(400);
    const switched = before === x.first.id && (await chartNow()) === x.other.id && !same(seatsOf(x.first), seatsOf(x.other));
    const d2 = await day(), h2 = await hist();
    check('another chart: the Day summary rows do not change', switched && same(d2.codes, want) && same(d2.codes, d1.codes), `chart "${x.other.name}"`);
    check('another chart: the History columns do not change', switched && same(h2.cols, want) && same(h2.cols, h1.cols));
    // A new chart is filled in the same order (unchanged code; it follows the roster).
    const fill = await page.evaluate((id) => { const a = window.__app; const ch = a.S.doc.charts.B3.find((c) => c.id === id); const out = [];
      for (const tb of a.Mo.chartFromTemplate(a.S.doc, 'B3', ch, 'x', 'dev').tables) for (const c of tb.seats) if (c) out.push(c); return out; }, x.other.id);
    check('a new chart fills its seats in the same roster order', same(fill, want.slice(0, fill.length)) && fill.length > 0);
  } catch (e) {
    check('run reached the end', false, e.message.split('\n')[0]);
  }
  await ctx.close();
}
console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
for (const t of SIZES.map((s) => s[2])) console.log(`  ${t}: ${results.filter((r) => r.startsWith('PASS') && r.includes(`[${t}]`)).length}/${results.filter((r) => r.includes(`[${t}]`)).length}`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
