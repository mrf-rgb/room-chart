// Touch taps as a phone sends them: touch start, touch end, then the browser's own click.
//   S=<folder> [VW=390 VH=844 TAG=phone] node tests/touch.mjs   (test server on 8123, fresh sample data)
// 1. A tap or long press on a seat's badge chips reaches the seat.
// 2. A tap (or long press) that opens a menu or the day view cannot also press a button in it:
//    the click that follows the finger's release lands on the new menu, and must be ignored.
import { chromium } from 'playwright-core';
const S = process.env.S;
const VW = Number(process.env.VW || 390), VH = Number(process.env.VH || 844), TAG = process.env.TAG || 'phone';
const URL = 'http://localhost:8123/?nosw=1&testdrive=http://localhost:8123/api';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = []; const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); };
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, isMobile: VW < 700 });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL); await page.waitForTimeout(1200);
await page.selectOption('#cls', 'B3'); await page.waitForTimeout(300);
const cdp = await ctx.newCDPSession(page);

// What the finger's events hit, for the report.
await page.evaluate(() => {
  const d = (t) => t.id ? '#' + t.id : (t.getAttribute && t.getAttribute('class') || t.nodeName).toString().split(' ')[0];
  window.__ev = [];
  for (const k of ['pointerdown', 'pointerup', 'click']) document.addEventListener(k, (e) => window.__ev.push(`${k}:${d(e.target)}`), true);
});
const events = () => page.evaluate(() => { const x = window.__ev.join(' '); window.__ev = []; return x; });
const marks = () => page.evaluate(() => window.__app.S.doc.marks.filter((m) => !m.deleted).length);
const sheetOpen = () => page.evaluate(() => !document.getElementById('sheet').hidden);
const modalOpen = () => page.evaluate(() => !document.getElementById('modal').hidden);
const closeAll = () => page.evaluate(() => { for (const id of ['sheet', 'modal']) { const e = document.getElementById(id); e.hidden = true; e.textContent = ''; } });
const tap = async (x, y) => { await page.touchscreen.tap(x, y); await page.waitForTimeout(250); };
const press = async (x, y, ms = 800) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
};
const mode = async (m) => { await page.locator(`.mode.m-${m}`).click(); await page.waitForTimeout(100); };
const seats = () => page.evaluate(() => [...document.querySelectorAll('.seat:not(.empty) .card')].map((c) => {
  const g = c.closest('.seat'); const r = c.getBoundingClientRect();
  return { t: +g.dataset.t, i: +g.dataset.i, x: r.x, y: r.y, w: r.width, h: r.height };
}));
// Sheet button boxes for a mode's menu, measured once with the sheet open.
const buttonBoxes = async (seat) => {
  await page.locator(`.seat[data-t="${seat.t}"][data-i="${seat.i}"]`).click();
  const b = await page.evaluate(() => [...document.querySelectorAll('.sheet-panel .sbtn')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent }; }));
  await closeAll(); return b;
};
// A point inside a seat card, clear of its chips, that also lies on a menu button.
const overlap = (list, boxes) => {
  for (const s of list) for (const b of boxes) {
    const x0 = Math.max(s.x + 4, b.x + 4), x1 = Math.min(s.x + s.w - 4, b.x + b.w - 4);
    const y0 = Math.max(s.y + 4, b.y + 4), y1 = Math.min(s.y + s.h * 0.45, b.y + b.h - 4);
    if (x1 > x0 && y1 > y0) return { seat: s, button: b.text, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  return null;
};

// ---------- Bug A: badge chips ----------
await page.locator('.mode.m-pos').click();
const all = await seats();
const s0 = all.sort((a, b) => a.y - b.y)[0];
await page.locator(`.seat[data-t="${s0.t}"][data-i="${s0.i}"]`).click();
await page.locator('.sheet-panel .sbtn').first().click(); await page.waitForTimeout(200);
const chip = await page.locator('.labels rect.chip').first().boundingBox();
await closeAll(); await events();
await tap(chip.x + chip.width / 2, chip.y + chip.height / 2);
const aTap = await events();
check('A: a tap on a badge chip opens that seat\'s menu', await sheetOpen(), aTap);
await closeAll();
await press(chip.x + chip.width / 2, chip.y + chip.height / 2);
check('A: a long press on a badge chip opens the day view', await modalOpen(), await events());
await closeAll();

// ---------- Bug B: the click after the finger's release ----------
const lower = (await seats()).filter((s) => s.y + s.h / 2 > VH / 2);
for (const [m, pick] of [['pos', null], ['neg', null], ['part', null], ['w', null]]) {
  await mode(m);
  const boxes = await buttonBoxes(lower[0]);
  const spot = overlap(lower, boxes.filter((b) => !b.text.includes('Cancel')));
  if (!spot) { check(`B: ${m} menu tap (no seat under a menu button at this size)`, true, 'not applicable'); continue; }
  const n0 = await marks(); await events();
  await tap(spot.x, spot.y);
  const ev = await events(); const n1 = await marks(); const open = await sheetOpen();
  check(`B: ${m} tap on a lower seat opens the menu and records nothing`, open && n1 === n0,
    `under the finger: "${spot.button}"; menu ${open ? 'open' : 'closed'}; marks ${n0}->${n1}; ${ev}`);
  // A deliberate tap on a button right after the menu opens still counts.
  if (open) {
    const b = await page.locator('.sheet-panel .sbtn').first().boundingBox();
    await page.waitForTimeout(60);
    await tap(b.x + b.width / 2, b.y + b.height / 2);
    check(`B: ${m} a quick deliberate tap on the menu records one mark`, (await marks()) === n0 + 1 && !(await sheetOpen()));
  }
  await closeAll();
}

// Long press: the day view (Mark absent, Delete) opens under the finger.
await mode('pos');
const lp = lower[lower.length - 1];
const nL = await marks(); await events();
await press(lp.x + lp.w / 2, lp.y + lp.h * 0.3);
const lpAbs = await page.evaluate(([t, i]) => { const a = window.__app; const S = a.S; const ch = S.doc.charts.B3.find((c) => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart)); return a.Mo.absentCodes(S.doc, 'B3', a.Mo.localDate()).has(ch.tables[t].seats[i]); }, [lp.t, lp.i]);
check('B: long press opens the day view and presses nothing in it', (await modalOpen()) && (await marks()) === nL && !lpAbs, await events());
await closeAll();

// Long press on a seat whose own day view puts "Mark absent" or "Delete" under the finger.
{
  const T = (await seats())[0];
  const at = (s) => page.locator(`.seat[data-t="${s.t}"][data-i="${s.i}"]`);
  for (let k = 0; k < 4; k++) { await at(T).click(); await page.locator('.sheet-panel .sbtn').first().click(); await page.waitForTimeout(100); }
  await press(T.x + T.w / 2, T.y + T.h * 0.3);
  const sv = await page.locator('#svg').boundingBox();
  const dvb = await page.evaluate(([top, bottom]) => [...document.querySelectorAll('.dayview button')]
    .filter((b) => /Mark absent|Delete/.test(b.textContent))
    .map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: e.textContent }; })
    .filter((b) => b.y > top + 40 && b.y < bottom - 40)
    // A point on the chart: clear of the controls' tab, which a finger close by would hit.
    .filter((b) => { const t = document.getElementById('ctl-tab'); if (!t) return true; const r = t.getBoundingClientRect();
      return b.x < r.left - 30 || b.x > r.right + 30 || b.y < r.top - 30 || b.y > r.bottom + 30; }), [sv.y, sv.y + sv.height]);
  await closeAll();
  if (!dvb.length) check('B: long press under a day-view button (none inside the chart area)', false);
  else {
    // Pan the chart so this seat sits under that button (with the mouse, so the next touch starts clean).
    const T1 = (await seats()).find((s) => s.t === T.t && s.i === T.i);
    const from = { x: T1.x + T1.w / 2, y: T1.y + T1.h * 0.3 }, to = dvb[0];
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const under = await page.evaluate(([x, y]) => { const s = document.elementFromPoint(x, y).closest('.seat'); return s ? `${s.dataset.t}.${s.dataset.i}` : ''; }, [to.x, to.y]);
    const n0 = await marks(); await events();
    const abs0 = await page.evaluate(() => { const a = window.__app; return a.Mo.absentCodes(a.S.doc, 'B3', a.Mo.localDate()).size; });
    await press(to.x, to.y);
    const ev = await events();
    const abs = await page.evaluate(() => { const a = window.__app; return a.Mo.absentCodes(a.S.doc, 'B3', a.Mo.localDate()).size; });
    const confirmOpen = await sheetOpen();
    check(`B: long press with the day view's "${to.text}" under the finger presses nothing`,
      under === `${T.t}.${T.i}` && (await modalOpen()) && !confirmOpen && (await marks()) === n0 && abs === abs0,
      `seat under finger ${under}; confirm ${confirmOpen ? 'open' : 'closed'}; absent ${abs0}->${abs}; ${ev}`);
    await closeAll();
  }
  await page.locator('#fit').click(); await page.waitForTimeout(150);
}

// Absent menu: its first button is Mark present.
await mode('att');
const ab = lower[0];
await tap(ab.x + ab.w / 2, ab.y + ab.h * 0.3); // Attendance mode: marks absent directly, by design
await mode('pos');
const abBoxes = await buttonBoxes(ab);
const abSpot = overlap([ab], abBoxes.filter((b) => !b.text.includes('Cancel'))) || { x: ab.x + ab.w / 2, y: ab.y + ab.h * 0.3, button: '(none)' };
await events();
await tap(abSpot.x, abSpot.y);
const stillAbsent = await page.evaluate(() => document.querySelectorAll('.seat.absent').length);
check('B: tap on an absent student opens the absent menu and stays absent', (await sheetOpen()) && stillAbsent === 1, `under the finger: "${abSpot.button}"; ${await events()}`);
await closeAll();

// A long press that opens the day view, then a quick deliberate tap on its Close button.
await press(lp.x + lp.w / 2, lp.y + lp.h * 0.3);
const cb = await page.locator('.modal-head .tbtn').boundingBox();
await tap(cb.x + cb.width / 2, cb.y + cb.height / 2);
check('day view: a deliberate tap on Close works', !(await modalOpen()));

// Edit mode by touch: the "empty" label passes a tap to its seat, and a table's grip still drags.
await page.locator('#edit').click(); await page.waitForTimeout(200);
const el = await page.locator('.labels .empty-label').first().boundingBox();
const full = (await seats())[0];
if (el) {
  // Labels are drawn in seat order, so the first "empty" label belongs to the first empty seat.
  const [et, ei] = await page.evaluate(() => { const g = document.querySelector('.seat.empty'); return [+g.dataset.t, +g.dataset.i]; });
  const code = await page.evaluate(([t, i]) => window.__app.S.draft.tables[t].seats[i], [full.t, full.i]);
  await tap(full.x + full.w / 2, full.y + full.h / 2);
  await tap(el.x + el.width / 2, el.y + el.height / 2);
  const now = await page.evaluate(([t, i]) => window.__app.S.draft.tables[t].seats[i], [et, ei]);
  check('edit: tap a student, then an "empty" label: the student moves there', now === code, `${code} -> seat ${et}.${ei} holds ${now}`);
}
const hb = await page.locator('.handle').first().boundingBox();
const t0 = await page.evaluate(() => ({ ...window.__app.S.draft.tables[0] }));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2, id: 1 }] });
for (let s = 1; s <= 6; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: hb.x + hb.width / 2 + s * 8, y: hb.y + hb.height / 2 + s * 8, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(200);
const t1 = await page.evaluate(() => ({ ...window.__app.S.draft.tables[0] }));
check('edit: a table drags by its grip with a finger', t1.x !== t0.x || t1.y !== t0.y, `${t0.x},${t0.y} -> ${t1.x},${t1.y}`);
await page.locator('#edit').click(); await page.waitForTimeout(150);
const leave = page.locator('.sheet-panel .sbtn', { hasText: 'Discard' });
if (await leave.count()) await leave.click();

await page.screenshot({ path: `${S}/shots/${TAG}-touch.png` });
console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
