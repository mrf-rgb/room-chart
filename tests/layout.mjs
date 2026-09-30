// Screen layout: controls on top in portrait, in a column on the left in landscape, and the tab
// that hides and shows them. Finger taps, at phone, tablet and laptop sizes, both ways round.
//   S=<folder> node tests/layout.mjs   (test server on 8123, fresh sample data in <folder>/drive1)
import { chromium } from 'playwright-core';
// A Worksheet tap asks for the lesson when the class has none for today (1.0.5); set it first, as in
// class. Works on either version: the lesson button opens a text box, or a list with 'Something else…'.
async function setLesson(page, label) {
  await page.locator('#lesson').click(); await page.waitForTimeout(150);
  if (!(await page.locator('.sheet-panel input').count())) { await page.locator('.sheet-panel .sbtn', { hasText: 'Something else' }).click(); await page.waitForTimeout(150); }
  await page.locator('.sheet-panel input').fill(label); await page.locator('.sheet-panel .sbtn.primary').click(); await page.waitForTimeout(150);
}
const S = process.env.S;
const URL = 'http://localhost:8123/?nosw=1&testdrive=http://localhost:8123/api';
const SIZES = [[390, 844, 'phone'], [844, 390, 'phone-landscape'], [1280, 800, 'tablet'], [800, 1280, 'tablet-portrait'], [1366, 768, 'laptop']];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = []; const errors = [];
let tag = '';
const check = (name, ok, extra = '') => { results.push({ tag, ok: !!ok, line: `${ok ? 'PASS' : 'FAIL'} [${tag}] ${name}${extra ? ' - ' + extra : ''}` }); };

for (const [VW, VH, t] of SIZES) {
  tag = t;
  const portrait = VH >= VW;
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, isMobile: Math.min(VW, VH) < 600 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${t}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${t}: ${m.text()}`); });
  await page.goto(URL); await page.waitForTimeout(1200);
  await page.selectOption('#cls', 'B3'); await page.waitForTimeout(300);

  await setLesson(page, 'Lesson A');

  // The column scrolls on a phone on its side; a finger scrolls it to the button first.
  const tap = async (sel) => { await page.locator(sel).scrollIntoViewIfNeeded({ timeout: 5000 }); const b = await page.locator(sel).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(350); };
  const box = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);
  const state = () => page.evaluate(() => ({ side: document.body.classList.contains('lay-side'), hidden: document.body.classList.contains('ctl-hidden'),
    topShown: getComputedStyle(document.getElementById('top')).display !== 'none', w: innerWidth, h: innerHeight }));
  const where = async () => {
    const s = await state(); const top = await box('#top'); const stage = await box('#stage');
    if (!s.topShown) return 'hidden';
    if (s.side && Math.round(top.x) === 0 && top.h >= s.h - 1 && Math.abs(stage.x - top.r) < 1 && stage.h >= s.h - 1) return 'left';
    if (!s.side && Math.round(top.y) === 0 && top.w >= s.w - 1 && Math.abs(stage.y - top.b) < 1) return 'top';
    return 'unclear';
  };
  // The chart is fitted when its zoom equals what Fit gives now.
  const fitted = () => page.evaluate(() => {
    const v = window.__app.view; const z = { ...v.z }; v.fit(); const f = { ...v.z }; v.z = z; v.applyZoom();
    return Math.abs(z.k - f.k) < 1e-6 && Math.abs(z.tx - f.tx) < 0.5 && Math.abs(z.ty - f.ty) < 0.5;
  });
  const zoomIn = () => page.evaluate(() => { const v = window.__app.view; v.z = { k: v.z.k * 1.6, tx: v.z.tx - 40, ty: v.z.ty - 30 }; v.applyZoom(); return { ...v.z }; });
  const zoomNow = () => page.evaluate(() => ({ ...window.__app.view.z }));
  const sameZ = (a, b) => Math.abs(a.k - b.k) < 1e-6 && Math.abs(a.tx - b.tx) < 0.5 && Math.abs(a.ty - b.ty) < 0.5;
  const marks = () => page.evaluate(() => window.__app.S.doc.marks.filter((m) => !m.deleted).length);
  const sheetOpen = () => page.evaluate(() => !document.getElementById('sheet').hidden);
  const modalOpen = () => page.evaluate(() => !document.getElementById('modal').hidden);
  const closeAll = () => page.evaluate(() => { for (const id of ['sheet', 'modal']) { const e = document.getElementById(id); e.hidden = true; e.textContent = ''; } });
  const seatBoxes = () => page.evaluate(() => [...document.querySelectorAll('.seat:not(.empty) .card')].map((c) => {
    const g = c.closest('.seat'); const r = c.getBoundingClientRect(); return { t: +g.dataset.t, i: +g.dataset.i, x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  const overlapsTab = async () => {
    const tb = await box('#ctl-tab'); if (!tb) return true;
    return (await seatBoxes()).some((s) => s.x < tb.r && s.x + s.w > tb.x && s.y < tb.b && s.y + s.h > tb.y);
  };
  const setting = async (v) => {
    await tap('#settings'); await page.waitForTimeout(200);
    await tap(`[data-controls="${v}"]`);
    await tap('.modal-head .tbtn'); await page.waitForTimeout(300);
  };

  try {
  // ---------- which layout ----------
  const expected = portrait ? 'top' : 'left';
  check(`controls ${expected === 'top' ? 'on top' : 'on the left'} at ${VW}x${VH}`, (await where()) === expected, await where());
  check('the page itself never scrolls; the chart has the rest of the screen', await page.evaluate(() => {
    const d = document.documentElement; const st = document.getElementById('stage').getBoundingClientRect(); const tp = document.getElementById('top').getBoundingClientRect();
    return d.scrollHeight <= innerHeight && d.scrollWidth <= innerWidth && (document.body.classList.contains('lay-side') ? Math.abs(st.width + tp.width - innerWidth) < 1 && Math.abs(st.height - innerHeight) < 1 : Math.abs(st.height + tp.height - innerHeight) < 1);
  }));
  const modeSizes = await page.evaluate(() => [...document.querySelectorAll('.mode')].map((m) => { const r = m.getBoundingClientRect(); return { w: r.width, h: r.height, over: m.scrollWidth > m.clientWidth + 1 }; }));
  if (!portrait) {
    const vertical = modeSizes.every((m, i) => i === 0 || m.w > 0);
    const ys = await page.evaluate(() => [...document.querySelectorAll('.mode')].map((m) => m.getBoundingClientRect().y));
    check('landscape: the mode bar is a vertical list', vertical && ys.every((y, i) => i === 0 || y > ys[i - 1]));
    // Today, in the top bar at this size, each mode button is at least 52 px tall and wider than that.
    check('landscape: each mode button is at least 52 px on its smaller side, labels fit', modeSizes.every((m) => Math.min(m.w, m.h) >= 52 && !m.over),
      modeSizes.map((m) => `${Math.round(m.w)}x${Math.round(m.h)}`).join(' '));
    const order = await page.evaluate(() => ['cls', 'chart', 'view', 'sync', 'lesson', 'modes', 'pick', 'summary', 'history', 'settings']
      .map((id) => document.getElementById(id).getBoundingClientRect().y));
    check('landscape: the column keeps the top bar\'s order (class, chart, view, sync, lesson, modes, Pick, Day, History, ⚙)',
      order.every((y, i) => i === 0 || y >= order[i - 1] - 0.5));
  }
  const edge = await page.evaluate(() => { const t = document.getElementById('ctl-tab'); if (!t) return false;
    const a = t.getBoundingClientRect(), c = document.getElementById('top').getBoundingClientRect();
    return document.body.classList.contains('lay-side') ? Math.abs(a.left - c.right) < 1 : Math.abs(a.top - c.bottom) < 1; });
  check('the tab sits on the edge of the controls and clears every seat', edge && !(await overlapsTab()));

  // ---------- rotation ----------
  await zoomIn();
  await page.setViewportSize({ width: VH, height: VW }); await page.waitForTimeout(400);
  const turned = await where();
  check(`after rotating to ${VH}x${VW}: controls ${portrait ? 'on the left' : 'on top'}, with no reload`, turned === (portrait ? 'left' : 'top') && await page.evaluate(() => !!window.__app.S.doc), turned);
  check('after rotating: the chart is refitted', await fitted());
  await page.setViewportSize({ width: VW, height: VH }); await page.waitForTimeout(400);
  check('after rotating back: layout and fit restored', (await where()) === expected && await fitted());

  // ---------- Settings choice ----------
  const forced = portrait ? 'side' : 'top';
  await zoomIn();
  await setting(forced);
  check(`Settings "${forced === 'side' ? 'Always on the left' : 'Always on top'}" overrides Automatic`, (await where()) === (forced === 'side' ? 'left' : 'top'), await where());
  check('after the Settings change: the chart is refitted', await fitted());
  await page.setViewportSize({ width: VH, height: VW }); await page.waitForTimeout(400);
  check('the forced layout holds after rotating', (await where()) === (forced === 'side' ? 'left' : 'top'));
  await page.setViewportSize({ width: VW, height: VH }); await page.waitForTimeout(400);
  await setting('auto');
  check('back to Automatic: the automatic layout returns', (await where()) === expected);
  // A choice that does not change the space keeps the teacher's own zoom.
  const z0 = await zoomIn();
  await setting(portrait ? 'top' : 'side');
  check('a Settings choice that leaves the space unchanged keeps the zoom', sameZ(await zoomNow(), z0) && (await where()) === expected);
  await setting('auto');
  check('the Settings choice is kept on this device', await page.evaluate(() => window.__app.S.meta.controls) === 'auto');

  // ---------- hide and show ----------
  await zoomIn();
  await tap('#ctl-tab');
  let s = await state();
  const tb = await box('#ctl-tab');
  const stage = await box('#stage');
  check('one tap on the tab hides all the controls; the chart fills the screen', s.hidden && !s.topShown && Math.abs(stage.w - VW) < 1 && Math.abs(stage.h - VH) < 1);
  check('hidden: the tab stays at the screen\'s edge', portrait ? Math.round(tb.y) === 0 : Math.round(tb.x) === 0, `${Math.round(tb.x)},${Math.round(tb.y)}`);
  check('after hiding: the chart is refitted and clear of the tab', await fitted() && !(await overlapsTab()));
  // After a fit, a finger on the seat nearest the tab, at the card's edge closest to it, reaches the seat.
  {
    const tb2 = await box('#ctl-tab');
    const cx = tb2.x + tb2.w / 2, cy = tb2.y + tb2.h / 2;
    const near = (await seatBoxes()).map((q) => { const px = Math.max(q.x + 3, Math.min(cx, q.x + q.w - 3)), py = Math.max(q.y + 3, Math.min(cy, q.y + q.h - 3));
      return { ...q, px, py, d: Math.hypot(px - cx, py - cy) }; }).sort((a, b) => a.d - b.d)[0];
    const nearCode = await page.evaluate((st) => window.__app.S.doc.charts.B3.find((c) => !c.deleted).tables[st.t].seats[st.i], near);
    await page.touchscreen.tap(near.px, near.py); await page.waitForTimeout(350);
    const ttl = await page.evaluate(() => { const e = document.querySelector('.sheet-panel .sheet-title'); return e ? e.textContent : ''; });
    check('hidden: a finger on the seat nearest the tab opens that seat, not the tab', ttl === nearCode && (await state()).hidden, `${Math.round(near.d)} px from the tab's centre`);
    await closeAll();
  }

  // The tab shows the current mode's letter and colour.
  const modeShown = [];
  for (const m of ['W', 'Pos', 'Neg', 'Part', 'Att']) {
    await page.evaluate((id) => { window.__app.S.meta.mode = id; }, m);
    await page.evaluate(() => document.getElementById('cls').dispatchEvent(new Event('change'))); await page.waitForTimeout(150); // re-render
    const got = await page.evaluate((id) => {
      const t = document.querySelector('#ctl-tab .tmode');
      const probe = document.createElement('div'); probe.className = 'mode m-' + id.toLowerCase(); probe.innerHTML = '<span class="mletter"></span>';
      document.body.append(probe); const want = getComputedStyle(probe.firstChild).backgroundColor; probe.remove();
      return { text: t && t.textContent, bg: t && getComputedStyle(t).backgroundColor, want };
    }, m);
    modeShown.push(got.text === { W: 'W', Pos: '+', Neg: '−', Part: 'P', Att: 'A' }[m] && got.bg === got.want);
  }
  check('hidden: the tab shows the current mode\'s letter and colour (all five modes)', modeShown.every(Boolean), modeShown.join(' '));
  await page.evaluate(() => { window.__app.S.meta.mode = 'W'; });
  await page.evaluate(() => document.getElementById('cls').dispatchEvent(new Event('change'))); await page.waitForTimeout(150);

  // Sync dot: green synced, amber waiting or offline, red on an error.
  await page.evaluate(() => window.__app.sync(false)); await page.waitForTimeout(500);
  const dot = () => page.evaluate(() => { const d = document.querySelector('#ctl-tab .tdot'); return d ? (d.classList.contains('bad') ? 'red' : d.classList.contains('warn') ? 'amber' : 'green') : 'none'; });
  const d1 = await dot();
  await ctx.setOffline(true); await page.waitForTimeout(300);
  const d2 = await dot();
  await ctx.setOffline(false); await page.waitForTimeout(800);
  await page.route('**/api/file/**', (r) => r.fulfill({ status: 500, body: 'no' }));
  await page.evaluate(() => window.__app.sync(false)); await page.waitForTimeout(500);
  const d3 = await dot();
  await page.unroute('**/api/file/**');
  await page.evaluate(() => window.__app.sync(false)); await page.waitForTimeout(600);
  const d4 = await dot();
  check('hidden: the sync dot is green when synced, amber offline, red on an error', d1 === 'green' && d2 === 'amber' && d3 === 'red' && d4 === 'green', [d1, d2, d3, d4].join(' '));

  // A tap on a seat with the controls hidden works as usual.
  const seat = (await seatBoxes()).sort((a, b) => a.y - b.y || a.x - b.x)[Math.floor((await seatBoxes()).length / 2)];
  const code = await page.evaluate((st) => window.__app.S.doc.charts.B3.find((c) => !c.deleted).tables[st.t].seats[st.i], seat);
  const before = await marks();
  const tapTime = await page.evaluate(() => window.__app.Mo.nowIso());
  await page.touchscreen.tap(seat.x + seat.w / 2, seat.y + seat.h * 0.3); await page.waitForTimeout(350);
  const title = await page.evaluate(() => { const e = document.querySelector('.sheet-panel .sheet-title'); return e ? e.textContent : ''; });
  check('hidden: a finger tap on a seat opens its menu, with nothing recorded yet', await sheetOpen() && title === code && (await marks()) === before, title);
  const four = await page.locator('.sheet-panel .sbtn', { hasText: 'most' }).boundingBox();
  await page.touchscreen.tap(four.x + four.width / 2, four.y + four.height / 2); await page.waitForTimeout(350);
  // The sizes share one data file, so the student may already have a mark from an earlier size: a tap then changes it.
  const rec = await page.evaluate(([c, since]) => { const m = window.__app.Mo.worksheetMark(window.__app.S.doc, 'B3', window.__app.Mo.localDate(), c, window.__app.Mo.lessonFor(window.__app.S.doc, 'B3', window.__app.Mo.localDate()));
    return m ? { value: m.value, fresh: m.edited >= since } : null; }, [code, tapTime]);
  check('hidden: choosing "most" records a 4 for that student', rec && rec.value === '4' && rec.fresh && !(await sheetOpen()), JSON.stringify(rec));

  // A finger tap on the tab never reaches a seat under it.
  await page.evaluate(() => {
    const v = window.__app.view; const tb = document.getElementById('ctl-tab').getBoundingClientRect(); const sv = document.getElementById('svg').getBoundingClientRect();
    const s = v.seatSpots.find((x) => x.code);
    v.z = { k: v.z.k * 1.4, tx: 0, ty: 0 }; v.z.tx = tb.x + tb.width / 2 - sv.x - s.x * v.z.k; v.z.ty = tb.y + tb.height / 2 - sv.y - s.y * v.z.k; v.applyZoom();
  });
  const under = await page.evaluate(() => { const tb = document.getElementById('ctl-tab').getBoundingClientRect(); const x = tb.x + tb.width / 2, y = tb.y + tb.height / 2;
    return [...document.querySelectorAll('.seat:not(.empty) .card')].some((c) => { const r = c.getBoundingClientRect(); return x > r.x && x < r.right && y > r.y && y < r.bottom; }); });
  const m0 = await marks();
  await tap('#ctl-tab');
  s = await state();
  check('a finger tap on the tab with a seat underneath: controls shown, no menu, no mark', under && !s.hidden && s.topShown && !(await sheetOpen()) && !(await modalOpen()) && (await marks()) === m0, `seat under tab: ${under}`);
  check('after showing: the chart is refitted', await fitted());
  // The same with the controls shown, and a long press on the tab.
  await page.evaluate(() => {
    const v = window.__app.view; const tb = document.getElementById('ctl-tab').getBoundingClientRect(); const sv = document.getElementById('svg').getBoundingClientRect();
    const s = v.seatSpots.find((x) => x.code);
    v.z = { k: v.z.k * 1.4, tx: 0, ty: 0 }; v.z.tx = tb.x + tb.width / 2 - sv.x - s.x * v.z.k; v.z.ty = tb.y + tb.height / 2 - sv.y - s.y * v.z.k; v.applyZoom();
  });
  await tap('#ctl-tab');
  s = await state();
  check('the same tap with the controls shown hides them: no menu, no mark', s.hidden && !(await sheetOpen()) && !(await modalOpen()) && (await marks()) === m0);
  const cdp = await ctx.newCDPSession(page);
  const tbb = await box('#ctl-tab');
  await page.evaluate(() => { const v = window.__app.view; const tb = document.getElementById('ctl-tab').getBoundingClientRect(); const sv = document.getElementById('svg').getBoundingClientRect();
    const s = v.seatSpots.find((x) => x.code); v.z.tx = tb.x + tb.width / 2 - sv.x - s.x * v.z.k; v.z.ty = tb.y + tb.height / 2 - sv.y - s.y * v.z.k; v.applyZoom(); });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tbb.x + tbb.w / 2, y: tbb.y + tbb.h / 2, id: 1 }] });
  await page.waitForTimeout(900);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
  check('a long press on the tab opens no day view and records nothing', !(await modalOpen()) && !(await sheetOpen()) && (await marks()) === m0);
  await closeAll();

  // Hidden or shown survives closing the app.
  if (!(await state()).hidden) await tap('#ctl-tab');
  await page.waitForTimeout(300);
  await page.reload(); await page.waitForTimeout(1200);
  s = await state();
  check('hidden survives a reload', s.hidden && !s.topShown && await fitted());
  await tap('#ctl-tab');
  await page.reload(); await page.waitForTimeout(1200);
  s = await state();
  check('shown survives a reload', !s.hidden && s.topShown && (await where()) === expected);

  // ---------- Edit mode ----------
  await tap('#edit'); await page.waitForTimeout(200);
  await tap('#ctl-tab');
  s = await state();
  const editbar = await page.evaluate(() => !document.getElementById('editbar').hidden && getComputedStyle(document.getElementById('editbar')).display !== 'none');
  const done = await box('#edit');
  check('Edit mode: a tap on the tab cannot hide the controls; the edit toolbar and Done stay on screen', !s.hidden && s.topShown && editbar && done.b <= VH + 0.5 && done.y >= 0);
  // Stored "hidden" (e.g. set on another screen) never hides the controls while editing.
  await page.evaluate(() => { window.__app.S.meta.ctlHidden = true; document.getElementById('cls').dispatchEvent(new Event('change')); });
  await page.waitForTimeout(200);
  s = await state();
  check('Edit mode shows the controls even when they were set to hidden', !s.hidden && s.topShown);
  await tap('#edit'); await page.waitForTimeout(250); // Done: nothing changed, so it leaves at once
  s = await state();
  check('after leaving Edit, the remembered hidden state returns', s.hidden && !(await page.evaluate(() => !!window.__app.S.draft)));
  await page.screenshot({ path: `${S}/shots/layout-${t}-hidden.png` });
  await tap('#ctl-tab');
  await page.screenshot({ path: `${S}/shots/layout-${t}.png` });
  } catch (e) { check('the run finished', false, e.message.split('\n')[0]); }
  await ctx.close();
}
await browser.close();

for (const r of results) console.log(r.line);
for (const [, , t] of SIZES) { const mine = results.filter((r) => r.tag === t); console.log(`${t}: ${mine.filter((r) => r.ok).length}/${mine.length}`); }
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
