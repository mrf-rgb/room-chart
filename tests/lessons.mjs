// A lesson that runs over several days keeps its worksheet completion. Finger taps, phone and tablet.
//   S=<folder> node tests/lessons.mjs   (test server on 8123, fresh sample data in <folder>/drive1)
// The data file is given a history first: B3 did "Day 1" yesterday (and the day before), "Intro" two
// days ago, "Old lesson" three days ago; the day plan has "Day 2" tomorrow and "Day 3" after it; B4
// also did a "Day 1" yesterday. Then, at each size:
// 1. The lesson list appears on the first Worksheet tap with no lesson, and never in the other modes.
// 2. It lists the two most recent lessons and the planned ones, and Cancel records nothing.
// 3. Picking a lesson opens the tapped student's menu at once, with yesterday's value as the current one.
// 4. A continued lesson shows yesterday's values, flagged as carried, on the seats and in the day summary.
// 5. A new tap saves today's value as a new mark and drops the flag; yesterday's mark is left alone.
// 6. Two devices continuing the same lesson agree after sync.
// 7. "Something else…" trims and reuses an existing label whatever its capitals; a new name works too.
// 8. The lesson button opens the same list. The hidden toast leaves no sliver on screen.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
const S = process.env.S;
const DIR = `${S}/drive1`;
const URL = 'http://localhost:8123/?nosw=1&testdrive=http://localhost:8123/api';
const SIZES = [[390, 844, 'phone'], [1280, 800, 'tablet']];
const results = []; const errors = [];
let tag = '';
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} [${tag}] ${name}${extra ? ' - ' + extra : ''}`);
const file = () => JSON.parse(readFileSync(`${DIR}/class-tracker-data.json`, 'utf8'));
const pristine = readFileSync(`${DIR}/class-tracker-data.json`, 'utf8');

const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmt = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' }) + ` ${m}/${d}`; };
const [TODAY, Y1, Y2, Y3, T1, T2] = [day(0), day(-1), day(-2), day(-3), day(1), day(2)];

// The history, written into the data file before the devices open it.
function seed() {
  const d = JSON.parse(pristine);
  const ch = d.charts.B3.find((c) => c.id === d.lastOpened.B3.chart);
  const seated = []; ch.tables.forEach((t) => t.seats.forEach((c) => { if (c) seated.push(c); }));
  const [c0, c1, c2, c3] = seated;
  const at = (date, hm) => `${date}T${hm}:00.000Z`;
  let n = 0;
  const w = (date, code, value, lesson, cls = 'B3', hm = '14:00') => ({ id: `seed-${n++}`, t: at(date, hm), date, class: cls, code, lesson, mode: 'W', value, reason: '', note: '', device: 'tablet-seed', edited: at(date, hm) });
  const p = (date, lesson, cls = 'B3') => ({ date, class: cls, lesson, updatedAt: at(date, '12:00'), by: 'tablet-seed' });
  d.marks.push(w(Y3, c0, '5', 'Old lesson'), w(Y2, c0, '4', 'Intro'), w(Y2, c0, '1', 'Day 1', 'B3', '15:00'),
    w(Y1, c0, '3', 'Day 1'), w(Y1, c1, '5', 'Day 1'), w(Y1, c2, '2', 'Day 1'), w(Y1, c3, '4', 'Day 1', 'B4'));
  d.dayPlan.push(p(Y3, 'Old lesson'), p(Y2, 'Intro'), p(Y1, 'Day 1'), p(T1, 'Day 2'), p(T2, 'Day 3'), p(Y1, 'B4 lesson', 'B4'));
  writeFileSync(`${DIR}/class-tracker-data.json`, JSON.stringify(d, null, 1));
  return { c0, c1, c2, c3, seedIds: d.marks.filter((m) => m.id.startsWith('seed-')).map((m) => JSON.stringify(m)) };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [VW, VH, t] of SIZES) {
  tag = t;
  const { c0, c1, c2, c3, seedIds } = seed();
  async function device() {
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, isMobile: VW < 700 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${t}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${t}: ${m.text()}`); });
    await page.goto(URL); await page.waitForTimeout(1200);
    await page.selectOption('#cls', 'B3'); await page.waitForTimeout(300);
    return { ctx, page };
  }
  const A = await device(), B = await device();
  const page = A.page;

  const seatOf = (pg, code, cls = 'B3') => pg.evaluate(({ code, cls }) => { const S = window.__app.S; const ch = S.doc.charts[cls].find((c) => c.id === (S.meta.chartBy[cls] || S.doc.lastOpened[cls].chart)); for (let t = 0; t < ch.tables.length; t++) { const i = ch.tables[t].seats.indexOf(code); if (i >= 0) return [t, i]; } }, { code, cls });
  const tapSeat = async (pg, code, cls) => { const [ti, i] = await seatOf(pg, code, cls); await pg.locator(`.seat[data-t="${ti}"][data-i="${i}"]`).tap(); await pg.waitForTimeout(250); };
  const mode = async (pg, m) => { await pg.locator(`.mode.m-${m}`).tap(); await pg.waitForTimeout(150); };
  const sheetOpen = (pg) => pg.evaluate(() => !document.getElementById('sheet').hidden);
  const sheetInfo = (pg) => pg.evaluate(() => {
    const sh = document.getElementById('sheet');
    if (sh.hidden) return null;
    return { title: (sh.querySelector('.sheet-title') || {}).textContent || '', sub: (sh.querySelector('.sheet-sub') || {}).textContent || '',
      buttons: [...sh.querySelectorAll('.sheet-buttons .sbtn')].map((b) => ({ text: b.textContent, pressed: b.getAttribute('aria-pressed') === 'true' })),
      cancel: !!sh.querySelector('.sheet-panel > .sbtn.cancel'), input: !!sh.querySelector('input') };
  });
  const isLessonList = (s) => !!(s && s.buttons.some((b) => b.text.startsWith('Something else')));
  const close = async (pg) => { if (await sheetOpen(pg)) { await pg.locator('.sheet-panel .sbtn.cancel').last().tap(); await pg.waitForTimeout(200); } };
  const tapBtn = async (pg, text) => { const b = pg.locator('.sheet-panel .sbtn', { hasText: text }).first(); if (!(await b.count())) return false; await b.tap(); await pg.waitForTimeout(300); return true; };
  const tapLevel = async (pg, digit) => { const b = pg.locator('.sheet-panel .sbtn', { has: pg.locator('.sletter', { hasText: new RegExp(`^${digit}$`) }) }).first(); if (!(await b.count())) return false; await b.tap(); await pg.waitForTimeout(250); return true; };
  const today = (pg) => pg.evaluate(() => { const a = window.__app, d = a.Mo.localDate(); return { lesson: a.Mo.lessonFor(a.S.doc, 'B3', d), marks: a.S.doc.marks.filter((m) => m.date === d && !m.deleted).length, plan: a.S.doc.dayPlan.filter((p) => p.date === d).length }; });
  const badge = (pg, code) => pg.evaluate(async (code) => {
    const a = window.__app, S = a.S, ch = S.doc.charts.B3.find((c) => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart));
    let ti, si; ch.tables.forEach((t, k) => { const i = t.seats.indexOf(code); if (i >= 0) { ti = k; si = i; } });
    const seat = document.querySelector(`.seat[data-t="${ti}"][data-i="${si}"]`);
    // The chip sits in the label layer; find the one inside this seat's card.
    const card = seat.querySelector('.card').getBoundingClientRect();
    const inCard = (e) => { const r = e.getBoundingClientRect(); return r.left >= card.left - 1 && r.right <= card.right + 1 && r.top >= card.top - 1 && r.bottom <= card.bottom + 8; };
    const w = [...document.querySelectorAll('.labels rect.chip')].filter((e) => /c-w\d/.test(e.getAttribute('class')) && inCard(e));
    const dot = [...document.querySelectorAll('.labels .chip-dot')].filter(inCard);
    const e = a.Mo.dayTally(S.doc, 'B3', a.Mo.localDate())[code] || {};
    return { W: e.W ?? null, carried: !!e.Wcarried, from: e.Wfrom || '', chip: w.length ? w[0].getAttribute('class') : '', dot: dot.length };
  }, code);

  try {
    // Toast: nothing of it on screen while it is hidden (it is empty at start).
    // The "Linked" toast from connecting goes first; then the toast as it is before any toast (empty) and after one.
    const toastGap = async () => { await page.waitForFunction(() => !document.getElementById('toast').classList.contains('show'), null, { timeout: 8000 }); await page.waitForTimeout(400);
      return page.evaluate(() => { const r = document.getElementById('toast').getBoundingClientRect(); return Math.round(innerHeight - r.top); }); };
    await toastGap();
    const kept = await page.evaluate(() => { const e = document.getElementById('toast'), k = e.textContent; e.textContent = ''; return k; });
    const emptyGap = await toastGap();
    await page.evaluate((k) => { document.getElementById('toast').textContent = k; }, kept);
    const usedGap = await toastGap();
    check('the hidden toast leaves no sliver on screen (empty, and after use)', emptyGap <= 0 && usedGap <= 0, `empty ${emptyGap} px, after use ${usedGap} px showing`);

    // 1. Not in the other four modes.
    const shown = [];
    for (const m of ['pos', 'neg', 'part']) { await mode(page, m); await tapSeat(page, c0); const s = await sheetInfo(page); shown.push(`${m}:${isLessonList(s) ? 'lesson list' : s ? 'reason menu' : 'nothing'}`); await close(page); }
    await mode(page, 'att'); await tapSeat(page, c0); const attSheet = await sheetInfo(page); shown.push(`att:${attSheet ? 'a sheet' : 'no sheet'}`); await close(page); await tapSeat(page, c0);
    check('no lesson list in Positive, Negative, Participation or Attendance mode', shown.join(' ') === 'pos:reason menu neg:reason menu part:reason menu att:no sheet', shown.join(' '));
    check('...and no lesson set by them', (await today(page)).lesson === '');

    // 1-2. The first Worksheet tap with no lesson: the list, in its order.
    await mode(page, 'w');
    await tapSeat(page, c0);
    const list = await sheetInfo(page);
    const texts = list ? list.buttons.map((b) => b.text) : [];
    check('Worksheet tap with no lesson opens the lesson list', isLessonList(list), list ? list.title + ' | ' + texts.join(' | ') : 'no sheet');
    const want = [`Day 1last used ${fmt(Y1)}`, `Introlast used ${fmt(Y2)}`, `Day 2planned ${fmt(T1)}`, `Day 3planned ${fmt(T2)}`, 'Something else…'];
    check('the list: two most recent lessons with their last date, the planned ones, Something else…, and Cancel', texts.join('|') === want.join('|') && list.cancel, texts.join(' | '));
    await page.screenshot({ path: `${S}/shots/lessons-${t}-list.png` });
    check('nothing older than the two most recent, nothing from another block', isLessonList(list) && !texts.some((x) => /Old lesson|B4 lesson/.test(x)));
    await close(page);
    const afterCancel = await today(page);
    check('Cancel on the list records nothing (no lesson, no mark)', isLessonList(list) && afterCancel.lesson === '' && afterCancel.plan === 0 && !(await sheetOpen(page)), JSON.stringify(afterCancel));

    // 3. Pick "Day 1": the tapped student's menu opens at once, with yesterday's value current.
    const marksBefore = (await today(page)).marks;
    await tapSeat(page, c0);
    const picked = isLessonList(await sheetInfo(page)) && await tapBtn(page, 'Day 1');
    const menu = await sheetInfo(page);
    const pressed = menu ? menu.buttons.filter((b) => b.pressed).map((b) => b.text) : [];
    check("picking a lesson opens the tapped student's worksheet menu at once", picked && !!menu && menu.title === c0 && menu.buttons.some((b) => b.text.includes('about half')), menu ? `${menu.title} | ${menu.sub}` : 'no sheet');
    check('the lesson is set for today and nothing is recorded yet', (await today(page)).lesson === 'Day 1' && (await today(page)).marks === marksBefore && (await page.locator('#lesson').textContent()) === 'Day 1');
    check(`the menu shows the carried value: "now 3, from ${fmt(Y1)}", 3 marked`, !!menu && menu.sub === `Worksheet · Day 1 · now 3, from ${fmt(Y1)}` && pressed.length === 1 && pressed[0].startsWith('3'), menu ? `${menu.sub} / marked ${pressed.join(',')}` : '');
    await close(page);

    // 4. Yesterday's values on the seats and in the day summary, flagged.
    const b0 = await badge(page, c0), b1 = await badge(page, c1), b2 = await badge(page, c2), b3 = await badge(page, c3);
    check("a continued lesson shows yesterday's values (latest edit), flagged as carried", b0.W === '3' && b1.W === '5' && b2.W === '2' && b0.carried && b1.carried && b0.from === Y1, `${JSON.stringify(b0)} ${JSON.stringify(b1)} ${JSON.stringify(b2)}`);
    check('the carried badge looks different: dashed outline and a dot', /carried/.test(b0.chip) && b0.dot === 1 && /carried/.test(b1.chip), `${b0.chip} dots ${b0.dot}`);
    check("another block's mark under the same lesson name does not show", b3.W === null, JSON.stringify(b3));
    await page.locator('#summary').tap(); await page.waitForTimeout(300);
    const sum = await page.evaluate(() => ({ carried: document.querySelectorAll('.grid-table .chipx.carried').length, key: !!document.querySelector('.carried-key') }));
    check('the day summary shows the same values with the flag', sum.carried === 3 && sum.key, JSON.stringify(sum));
    await page.locator('.modal-head .tbtn').tap(); await page.waitForTimeout(200);
    await page.screenshot({ path: `${S}/shots/lessons-${t}-carried.png` });

    // 5. A new tap: today's value replaces the flag, as a new mark dated today.
    await tapSeat(page, c0);
    const m2 = await sheetInfo(page);
    check('with a lesson set, a Worksheet tap goes straight to the menu', !!m2 && !isLessonList(m2) && m2.title === c0, m2 ? m2.title : 'no sheet');
    await page.screenshot({ path: `${S}/shots/lessons-${t}-menu.png` });
    const was0 = await badge(page, c0);
    await tapLevel(page, '4');
    const nb0 = await badge(page, c0);
    check("a new tap replaces the flag with today's value", was0.carried && was0.W === '3' && nb0.W === '4' && !nb0.carried && !/carried/.test(nb0.chip) && nb0.dot === 0, JSON.stringify(nb0));
    await page.evaluate(() => window.__app.sync(true)); await page.waitForTimeout(300);
    const f1 = file();
    const mine = f1.marks.filter((m) => m.mode === 'W' && m.code === c0 && m.class === 'B3' && !m.deleted && m.lesson === 'Day 1').map((m) => [m.date, m.value]).sort();
    check('saved as a new mark dated today; the earlier days stay as they were', JSON.stringify(mine) === JSON.stringify([[Y2, '1'], [Y1, '3'], [TODAY, '4']]) &&
      seedIds.every((s) => f1.marks.some((m) => JSON.stringify(m) === s)), JSON.stringify(mine));

    // 6. A second device continues the same lesson on its own, then both sync.
    await mode(B.page, 'w');
    await tapSeat(B.page, c1);
    const bl = await sheetInfo(B.page);
    const bDay1 = await tapBtn(B.page, 'Day 1');
    const bm = await sheetInfo(B.page);
    check('the other device: its own list, then the menu with the carried value', isLessonList(bl) && bDay1 && !!bm && bm.sub === `Worksheet · Day 1 · now 5, from ${fmt(Y1)}`, bm ? bm.sub : 'no sheet');
    await tapLevel(B.page, '2');
    const syncOf = (d) => d.page.evaluate(() => window.__app.sync(true));
    await syncOf(A); await syncOf(B); await syncOf(A);
    await page.waitForTimeout(200);
    const views = [];
    for (const d of [A, B]) views.push(await Promise.all([c0, c1, c2].map(async (c) => { const x = await badge(d.page, c); return `${x.W}${x.carried ? '*' : ''}`; })));
    check('two devices continuing the same lesson agree after sync', views[0].join(',') === '4,2,2*' && views[1].join(',') === '4,2,2*', `tablet-side ${views[0].join(',')} / other ${views[1].join(',')}`);
    const fp = (d) => d.page.evaluate(() => window.__app.Mo.fingerprint(window.__app.S.doc));
    const f2 = file();
    const perDay = {}; for (const m of f2.marks) if (m.mode === 'W' && !m.deleted && m.class === 'B3' && m.date === TODAY) { const k = `${m.code}|${m.lesson}`; perDay[k] = (perDay[k] || 0) + 1; }
    check('...the same document everywhere, one live mark per student and lesson today', (await fp(A)) === (await fp(B)) && Object.values(perDay).every((n) => n === 1) && Object.keys(perDay).length === 2, JSON.stringify(Object.values(perDay)));
    await B.page.screenshot({ path: `${S}/shots/lessons-${t}-second-device.png` });

    // 8. The lesson button opens the same list, with today's lesson marked.
    await page.locator('#lesson').tap(); await page.waitForTimeout(250);
    const lb = await sheetInfo(page);
    const lbTexts = lb ? lb.buttons.map((b) => b.text) : [];
    check('the lesson button opens the same list, today\'s lesson marked', isLessonList(lb) && lbTexts[0] === 'Day 1planned today' && lb.buttons[0].pressed && lbTexts.includes(`Introlast used ${fmt(Y2)}`) && lbTexts.includes(`Day 2planned ${fmt(T1)}`), lbTexts.join(' | '));
    // 7. "Something else…" with a known name in other capitals: the existing label is reused.
    await tapBtn(page, 'Something else');
    const box = page.locator('.sheet-panel input');
    const prefilled = (await box.count()) ? await box.inputValue() : null;
    if (await box.count()) { await box.fill('  intro  '); await page.locator('.sheet-panel .sbtn.primary').tap(); await page.waitForTimeout(300); }
    const relabel = await page.evaluate((c0) => { const a = window.__app, d = a.Mo.localDate(); return { lesson: a.Mo.lessonFor(a.S.doc, 'B3', d), mark: (a.S.doc.marks.find((m) => m.date === d && m.code === c0 && m.mode === 'W' && !m.deleted) || {}).lesson }; }, c0);
    check('"Something else…" opens the text box with today\'s lesson in it', prefilled === 'Day 1', String(prefilled));
    check('"  intro  " is trimmed and becomes the existing "Intro"; today\'s marks follow it', relabel.lesson === 'Intro' && relabel.mark === 'Intro', JSON.stringify(relabel));
    const ib0 = await badge(page, c0);
    check("after the switch, today's relabelled mark shows, not a carried value", ib0.W === '4' && ib0.carried === false, JSON.stringify(ib0));
    const ib1 = await badge(page, c1);
    check('...and a student with no Intro mark shows no carried value', ib1.W === '2', JSON.stringify(ib1)); // today's own mark, relabelled

    // 7. A brand-new name typed on a Worksheet tap in a block with no history: trimmed, then the menu opens.
    await page.selectOption('#cls', 'B5'); await page.waitForTimeout(300);
    const b5code = await page.evaluate(() => { const S = window.__app.S; const ch = S.doc.charts.B5.find((c) => c.id === (S.meta.chartBy.B5 || S.doc.lastOpened.B5.chart)); for (const t of ch.tables) for (const c of t.seats) if (c) return c; });
    await tapSeat(page, b5code, 'B5');
    const b5list = await sheetInfo(page);
    const b5texts = b5list ? b5list.buttons.map((b) => b.text) : [];
    await tapBtn(page, 'Something else');
    if (await page.locator('.sheet-panel input').count()) { await page.locator('.sheet-panel input').fill('  Quiz 1 '); await page.locator('.sheet-panel .sbtn.primary').tap(); await page.waitForTimeout(300); }
    const qm = await sheetInfo(page);
    const b5lesson = await page.evaluate(() => window.__app.Mo.lessonFor(window.__app.S.doc, 'B5', window.__app.Mo.localDate()));
    check('a block with no history offers only "Something else…"; a typed name is trimmed and the menu opens at once',
      b5texts.join('|') === 'Something else…' && b5lesson === 'Quiz 1' && !!qm && qm.title === b5code && qm.sub === 'Worksheet · Quiz 1', `${b5texts.join(' | ')} / "${b5lesson}" / ${qm ? qm.sub : 'no menu'}`);
    await close(page);

    // The toast after use: shown, then hidden with no sliver.
    await page.evaluate(() => window.__app.sync(true)); await page.waitForTimeout(3200);
    check('after a toast has come and gone, still no sliver', (await toastGap()) <= 0, `${await toastGap()} px showing`);
  } catch (e) {
    check('run reached the end', false, e.message.split('\n')[0]);
  }
  await A.ctx.close(); await B.ctx.close();
}
console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
for (const t of SIZES.map((s) => s[2])) console.log(`  ${t}: ${results.filter((r) => r.startsWith('PASS') && r.includes(`[${t}]`)).length}/${results.filter((r) => r.includes(`[${t}]`)).length}`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
