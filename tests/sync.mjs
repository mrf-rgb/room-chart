// Two browser profiles (separate storage), one shared data file through the test Drive endpoint.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
const S = process.env.S;
const DIR = `${S}/drive1`;
const URL = 'http://localhost:8123/?nosw=1&testdrive=http://localhost:8123/api';
const results = []; const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
const file = () => JSON.parse(readFileSync(`${DIR}/class-tracker-data.json`, 'utf8'));
const inboxBefore = readFileSync(`${DIR}/class-tracker-inbox.json`, 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function device(vp) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL); await page.waitForTimeout(1200);
  await page.selectOption('#cls', 'B3'); await page.waitForTimeout(200);
  return { ctx, page };
}
const A = await device({ width: 1280, height: 800 });
const B = await device({ width: 390, height: 844 });
const ids = await A.page.evaluate(() => window.__app.S.doc.roster.B3.map((s) => s.code));

// Marks written straight into each device's local store through the app's own mark path: tap flow.
async function tapMarks(dev, codes, mode, pick) {
  await dev.page.locator(`.mode.m-${mode}`).click();
  for (const code of codes) {
    const pos = await dev.page.evaluate((code) => { const S = window.__app.S; const ch = S.doc.charts.B3.find((c) => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart)); for (let t = 0; t < ch.tables.length; t++) { const i = ch.tables[t].seats.indexOf(code); if (i >= 0) return [t, i]; } }, code);
    await dev.page.locator(`.seat[data-t="${pos[0]}"][data-i="${pos[1]}"]`).click();
    if (pick) { await dev.page.locator('.sheet-panel .sbtn', { hasText: pick }).click(); }
    await dev.page.waitForTimeout(80);
  }
}
await tapMarks(A, ids.slice(0, 5), 'pos', 'strong effort');
await tapMarks(B, ids.slice(5, 9), 'neg', 'chatting');
// absent on A, then later the undo on B
await tapMarks(A, [ids[10]], 'att');
await B.page.waitForTimeout(50);
// B has not seen A's absent yet; B marks absent then present (undo) later than A's tap
await tapMarks(B, [ids[10]], 'att'); await tapMarks(B, [ids[10]], 'att');

// chart save on A first, then on B (later) for the same chart
async function editSave(dev, action) {
  await dev.page.locator('#edit').click();
  await dev.page.locator(`.seat[data-t="${action.t}"][data-i="0"]`).click(); // a tap on a seat selects its table
  await dev.page.locator(action.btn).click();
  await dev.page.locator('#edit').click();
  await dev.page.locator('.sheet-panel .sbtn', { hasText: 'Save (overwrite' }).click();
  await dev.page.waitForTimeout(100);
}
await editSave(A, { t: 0, btn: '#e-turn' });
await A.page.waitForTimeout(30);
await editSave(B, { t: 2, btn: '#e-right' });

// Race: both sync at the same moment, twice over.
const both = () => Promise.all([A.page.evaluate(() => window.__app.sync(true)), B.page.evaluate(() => window.__app.sync(true))]);
await both();
const mid = file().marks.length;
await both(); await both();
const f = file();
const expected = 5 + 4 + 3; // 5 Pos, 4 Neg, 3 Abs entries
check('race: after two more rounds every tap from both devices is in the file', f.marks.length === expected, `after first race ${mid}, final ${f.marks.length} of ${expected}`);
const fpA = await A.page.evaluate(() => window.__app.Mo.fingerprint(window.__app.S.doc));
const fpB = await B.page.evaluate(() => window.__app.Mo.fingerprint(window.__app.S.doc));
const fpF = await A.page.evaluate((d) => window.__app.Mo.fingerprint(d), f);
check('both devices and the file hold the same document', fpA === fpB && fpA === fpF);
const absentNow = await A.page.evaluate((code) => { const a = window.__app; return a.Mo.absentCodes(a.S.doc, 'B3', a.Mo.localDate()).has(code); }, ids[10]);
check('absent on one device, undo later on the other: present wins (latest edit)', absentNow === false);
const reg = f.charts.B3.find((c) => c.id === 'regular');
check('same chart saved on both: the later save wins whole', reg.tables[2].rot === 15 && reg.tables[0].rot === 0, `t0 ${reg.tables[0].rot}, t2 ${reg.tables[2].rot}, by ${reg.updatedBy}`);
for (const [n, d] of [['A', A], ['B', B]]) { await d.page.waitForTimeout(100); const p = await d.page.locator('#sync').textContent(); check(`device ${n} shows Synced`, p.includes('Synced'), p); }

// Offline on A
await A.ctx.setOffline(true);
await A.page.evaluate(() => window.dispatchEvent(new Event('offline')));
await tapMarks(A, [ids[11]], 'part', 'group work');
await A.page.waitForTimeout(300);
const offPill = await A.page.locator('#sync').textContent();
check('offline: tap saved locally, pill shows waiting', /Offline . 1 waiting/.test(offPill), offPill);
await A.ctx.setOffline(false);
await A.page.route('**/api/**', (r) => r.abort()); // Drive unreachable, page still loads
await A.page.reload(); await A.page.waitForTimeout(800);
const kept = await A.page.evaluate(() => window.__app.S.doc.marks.length);
check('unsynced tap survives a reload (IndexedDB)', kept === expected + 1, `local ${kept}`);
await A.page.unroute('**/api/**');
await A.page.evaluate(() => window.__app.sync(true));
await A.page.waitForTimeout(1500);
check('back online: synced to the file', file().marks.length === expected + 1 && (await A.page.locator('#sync').textContent()).includes('Synced'));

// Inbox: desktop side adds a chart, seeds a name and a day plan entry
const inbox = JSON.parse(inboxBefore);
const t = new Date().toISOString();
inbox.charts = { B3: [{ id: 'desk-test-day', name: 'Test day', createdAt: t, updatedAt: t, updatedBy: 'desktop', tables: f.charts.B3[0].tables }] };
inbox.roster = { B3: [{ ...f.roster.B3.find((s) => s.code === ids[0]), name: 'Riley', updatedAt: t }] };
inbox.dayPlan = [{ date: await A.page.evaluate(() => window.__app.Mo.localDate()), class: 'B3', lesson: 'M8-U1-D14', updatedAt: t, by: 'desktop' }];
writeFileSync(`${DIR}/class-tracker-inbox.json`, JSON.stringify(inbox, null, 1));
const inboxText = readFileSync(`${DIR}/class-tracker-inbox.json`, 'utf8');
await B.page.evaluate(() => window.__app.sync(true)); await B.page.waitForTimeout(300);
const bView = await B.page.evaluate(() => { const a = window.__app; return { charts: a.Mo.liveCharts(a.S.doc, 'B3').map((c) => c.name), lesson: a.Mo.lessonFor(a.S.doc, 'B3', a.Mo.localDate()) }; });
check('inbox merge: new chart, seeded name and day plan arrive', bView.charts.includes('Test day') && bView.lesson === 'M8-U1-D14' && (await B.page.locator('.labels .name', { hasText: 'Riley' }).count()) === 1, JSON.stringify(bView));
check('the app never writes the inbox file', readFileSync(`${DIR}/class-tracker-inbox.json`, 'utf8') === inboxText);
check('inbox content now in the data file', file().charts.B3.some((c) => c.id === 'desk-test-day'));
await B.page.screenshot({ path: `${S}/shots/sync-phone-after-inbox.png` });
console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
// Forced lost write: another device overwrites the file with a stale copy that lacks B's marks.
const stale = file();
stale.marks = stale.marks.filter((m) => !m.device.startsWith('phone'));
const lostN = file().marks.length - stale.marks.length;
writeFileSync(`${DIR}/class-tracker-data.json`, JSON.stringify(stale));
await B.page.evaluate(() => window.__app.sync(true));
check('a clobbered write heals: the device whose marks were lost puts them back on its next sync', file().marks.length === stale.marks.length + lostN && lostN > 0, `lost ${lostN}, file now ${file().marks.length}`);
console.log(results[results.length - 1]);
// Service worker: once loaded, the app opens with no network at all.
const C = await browser.newContext({ viewport: { width: 800, height: 1280 } });
const cp = await C.newPage();
await cp.goto('http://localhost:8123/?demo=1'); await cp.waitForTimeout(1500);
await cp.evaluate(() => navigator.serviceWorker.ready);
await cp.reload(); await cp.waitForTimeout(800);
await C.setOffline(true);
let swOk = false;
try { await cp.reload(); await cp.waitForTimeout(1000); swOk = (await cp.locator('.seat').count()) > 20; } catch (e) { swOk = false; }
check('service worker: the app opens offline (no network) with its data', swOk);
console.log(results[results.length - 1]);
await browser.close();
