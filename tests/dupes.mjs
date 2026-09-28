// Two devices, one data file: each makes a worksheet mark (and a note) for the same student before
// they sync. After sync there is one live mark, both devices show the latest edit, and a correction
// on either device shows on both.
//   S=<folder> node tests/dupes.mjs   (test server on 8123, fresh sample data in <folder>/drive1)
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const S = process.env.S;
const DIR = `${S}/drive1`;
const URL = 'http://localhost:8123/?nosw=1&testdrive=http://localhost:8123/api';
const results = []; const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
const file = () => JSON.parse(readFileSync(`${DIR}/class-tracker-data.json`, 'utf8'));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function device(vp) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL); await page.waitForTimeout(1200);
  await page.selectOption('#cls', 'B3'); await page.waitForTimeout(200);
  await page.locator('.mode.m-w').click();
  return { ctx, page };
}
const A = await device({ width: 1280, height: 800 }); // tablet
const B = await device({ width: 390, height: 844 });  // phone
const [code, code2] = await A.page.evaluate(() => window.__app.S.doc.roster.B3.slice(0, 2).map((s) => s.code));

const seat = (dev, c) => dev.page.evaluate((c) => { const S = window.__app.S; const ch = S.doc.charts.B3.find((x) => x.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart)); for (let t = 0; t < ch.tables.length; t++) { const i = ch.tables[t].seats.indexOf(c); if (i >= 0) return [t, i]; } }, c);
// Tap the student, note what the menu says the mark is now, pick a level by its digit.
async function tapW(dev, digit, c = code) {
  const [t, i] = await seat(dev, c);
  await dev.page.locator(`.seat[data-t="${t}"][data-i="${i}"]`).click();
  const sub = await dev.page.locator('.sheet-sub').textContent();
  await dev.page.locator('.sheet-panel .sbtn', { has: dev.page.locator('.sletter', { hasText: digit }) }).first().click();
  await dev.page.waitForTimeout(80);
  return sub;
}
// The digit on the student's badge.
const badge = async (dev, c = code) => {
  const [t, i] = await seat(dev, c);
  return dev.page.evaluate(({ t, i, c }) => { const a = window.__app; return (a.Mo.dayTally(a.S.doc, 'B3', a.Mo.localDate())[c] || {}).W ?? null; }, { t, i, c });
};
const liveW = (c = code) => file().marks.filter((m) => m.mode === 'W' && m.code === c && !m.deleted);
const sync = (d) => d.page.evaluate(() => window.__app.sync(true));
const syncAll = async () => { await sync(A); await sync(B); await sync(A); };

// 1. Both devices mark the same student before syncing.
await tapW(A, '2');
await A.page.waitForTimeout(30);
await tapW(B, '3');
await syncAll();
check('after sync the file holds one live worksheet mark for the student', liveW().length === 1, `live ${liveW().length}`);
const [bA, bB] = [await badge(A), await badge(B)];
check('both devices show the same mark, the latest edit', bA === '3' && bB === '3', `tablet ${bA}, phone ${bB}`);
const subA = await tapW(A, '1');
check("the tablet's menu says the mark shown on the badge", subA.endsWith('now 3'), subA);

// 2. The tablet corrects the grade; both devices show the correction.
await A.page.waitForTimeout(50);
check('the tablet shows its correction at once', (await badge(A)) === '1', `tablet ${await badge(A)}`);
await syncAll();
check('after sync both devices show the tablet correction', (await badge(A)) === '1' && (await badge(B)) === '1', `tablet ${await badge(A)}, phone ${await badge(B)}`);

// 3. The phone corrects it again; both devices show that.
const subB = await tapW(B, '0');
await syncAll();
check('a correction on the phone shows on both devices', subB.endsWith('now 1') && (await badge(A)) === '0' && (await badge(B)) === '0' && liveW().length === 1, `menu "${subB}", tablet ${await badge(A)}, phone ${await badge(B)}, live ${liveW().length}`);

// 4. Notes from both devices; the tablet then edits the note it shows.
async function saveNote(dev, text) {
  const [t, i] = await seat(dev, code);
  const box = await dev.page.locator(`.seat[data-t="${t}"][data-i="${i}"]`).boundingBox();
  await dev.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await dev.page.mouse.down(); await dev.page.waitForTimeout(800); await dev.page.mouse.up();
  await dev.page.waitForTimeout(200);
  const before = await dev.page.locator('.dayview .pnote').inputValue();
  await dev.page.locator('.dayview .pnote').fill(text);
  await dev.page.locator('.dayview button', { hasText: 'Save note' }).click(); await dev.page.waitForTimeout(200);
  await dev.page.locator('.modal-head .tbtn').click(); await dev.page.waitForTimeout(100);
  return before;
}
await saveNote(A, 'note from the tablet'); await A.page.waitForTimeout(30); await saveNote(B, 'note from the phone');
await syncAll();
const liveNotes = () => file().marks.filter((m) => m.mode === 'Note' && m.code === code && !m.deleted);
check('after sync one live note for the student', liveNotes().length === 1, `live ${liveNotes().length}`);
const shownA = await saveNote(A, 'edited on the tablet');
await syncAll();
const noteB = await B.page.evaluate((c) => { const a = window.__app; const d = a.Mo.localDate(); return { dv: (a.Mo.noteMark(a.S.doc, 'B3', d, c) || {}).note, tally: a.Mo.dayTally(a.S.doc, 'B3', d)[c].note }; }, code);
check("the tablet edits the note it shows; the phone's day view shows the edit", shownA === 'note from the phone' && noteB.dv === 'edited on the tablet' && noteB.tally === 'edited on the tablet', `tablet showed "${shownA}", phone ${JSON.stringify(noteB)}`);

// 5. Offline: the phone marks a second student the tablet has already marked, then reconnects.
await tapW(A, '2', code2);
await sync(A);
await B.ctx.setOffline(true);
await B.page.evaluate(() => window.dispatchEvent(new Event('offline')));
await B.page.waitForTimeout(50);
await tapW(B, '3', code2); // the phone never saw the tablet's mark for this student
check('offline: the phone keeps its own mark', (await badge(B, code2)) === '3');
await B.ctx.setOffline(false);
await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
await B.page.waitForTimeout(200);
await syncAll();
check('back online: one live mark, the later edit (the phone), on both devices', liveW(code2).length === 1 && (await badge(A, code2)) === '3' && (await badge(B, code2)) === '3', `live ${liveW(code2).length}, tablet ${await badge(A, code2)}, phone ${await badge(B, code2)}`);

const fp = (d) => d.page.evaluate(() => window.__app.Mo.fingerprint(window.__app.S.doc));
const fpF = await A.page.evaluate((d) => window.__app.Mo.fingerprint(d), file());
check('both devices and the file hold the same document', (await fp(A)) === (await fp(B)) && (await fp(A)) === fpF);
await B.page.screenshot({ path: `${S}/shots/dupes-phone.png` });
console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
