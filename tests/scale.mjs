// Worksheet scale 0 to 5: the menu, each level's value, digit and colour, and marks made on the old
// 0-3 scale still showing as their own digit.
//   S=<folder> [VW=390 VH=844 TAG=phone] node tests/scale.mjs   (test server on 8123, fresh sample data)
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
await page.locator('.mode.m-w').click();

const LEVELS = [['5', 'all done'], ['4', 'most'], ['3', 'about half'], ['2', 'some'], ['1', 'started'], ['0', 'nothing']];
const seated = await page.evaluate(() => { const S = window.__app.S; const ch = S.doc.charts.B3.find((c) => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart)); const out = []; ch.tables.forEach((t, ti) => t.seats.forEach((c, i) => { if (c) out.push({ t: ti, i, code: c }); })); return out; });
const seat = (s) => page.locator(`.seat[data-t="${s.t}"][data-i="${s.i}"]`);
const today = await page.evaluate(() => window.__app.Mo.localDate());

// The menu.
await seat(seated[0]).tap();
await page.waitForTimeout(200);
const btns = await page.evaluate(() => [...document.querySelectorAll('.sheet-panel .sheet-buttons .sbtn')].map((b) => {
  const r = b.getBoundingClientRect(), l = b.querySelector('.sletter');
  return { digit: l ? l.textContent : '', text: b.textContent.slice(l ? l.textContent.length : 0), top: r.top, bottom: r.bottom, h: r.height, bg: l ? getComputedStyle(l).backgroundColor : '' };
}));
const want = LEVELS.map(([d, l]) => d + ' ' + l).concat('A Absent').join(' | ');
const got = btns.map((b) => b.digit + ' ' + b.text).join(' | ');
check('menu: 5 all done, 4 most, 3 about half, 2 some, 1 started, 0 nothing, then Absent', got === want, got);
const bgs = btns.slice(0, 6).map((b) => b.bg);
check('each level has its own colour and shows its digit', new Set(bgs).size === 6 && btns.slice(0, 6).every((b) => /^[0-5]$/.test(b.digit)) && !bgs.includes('rgb(229, 231, 235)'), bgs.join(' '));
check('fast to tap: every choice on screen at once, each at least 56 px tall', btns.length === 7 && btns.every((b) => b.top >= 0 && b.bottom <= VH && b.h >= 56), btns.map((b) => `${Math.round(b.top)}-${Math.round(b.bottom)}`).join(' '));
await page.screenshot({ path: `${S}/shots/${TAG}-scale-menu.png` });
await page.locator('.sheet-panel .cancel').click();

// Each level records its value and shows its digit in its own colour on the badge and the day summary.
const recorded = [];
for (let k = 0; k < LEVELS.length; k++) {
  const [d, label] = LEVELS[k];
  const s = seated[k + 1];
  await seat(s).tap(); await page.waitForTimeout(150);
  const b = page.locator('.sheet-panel .sbtn', { hasText: label });
  if (await b.count()) { await b.first().tap(); await page.waitForTimeout(150); }
  else await page.locator('.sheet-panel .cancel').click();
  const v = await page.evaluate(({ code, today }) => { const m = window.__app.S.doc.marks.find((x) => x.code === code && x.mode === 'W' && x.date === today && !x.deleted); return m ? m.value : null; }, { code: s.code, today });
  recorded.push(`${d}:${v}`);
}
check('each level records its own value (5 4 3 2 1 0)', recorded.join(' ') === '5:5 4:4 3:3 2:2 1:1 0:0', recorded.join(' '));
const chips = await page.evaluate(() => [...document.querySelectorAll('.chip-t')].filter((e) => /c-w\d/.test(e.getAttribute('class'))).map((e) => {
  const cls = /c-w(\d)/.exec(e.getAttribute('class'))[1];
  const rect = [...e.parentNode.querySelectorAll('rect.chip')].find((r) => r.getAttribute('class').includes('c-w' + cls));
  return { cls, text: e.textContent, fill: rect ? getComputedStyle(rect).fill : '' };
}));
const byDigit = {};
for (const c of chips) byDigit[c.text] = c.fill;
check('badges: six digits, six colours', ['0', '1', '2', '3', '4', '5'].every((d) => byDigit[d]) && new Set(Object.values(byDigit)).size === 6 && chips.every((c) => c.cls === c.text), JSON.stringify(byDigit));
await page.screenshot({ path: `${S}/shots/${TAG}-scale-badges.png` });
await page.locator('#summary').click(); await page.waitForTimeout(200);
const sum = await page.evaluate(() => [...document.querySelectorAll('.grid-table .chipx')].filter((e) => /c-w\d/.test(e.className)).map((e) => ({ text: e.textContent, bg: getComputedStyle(e).backgroundColor })));
check('day summary: the six levels with their digits and colours', new Set(sum.map((x) => x.text)).size === 6 && new Set(sum.map((x) => x.bg)).size === 6, sum.map((x) => x.text + ' ' + x.bg).join(', '));
await page.screenshot({ path: `${S}/shots/${TAG}-scale-summary.png` });
await page.locator('.modal-head .tbtn').click();

// Marks from an older version (0-3) still show as their own digit until they are converted.
await page.evaluate(({ codes, today }) => {
  const a = window.__app;
  codes.forEach((code, k) => {
    const t = new Date(Date.now() - 3600000).toISOString();
    a.S.doc.marks = a.S.doc.marks.filter((m) => !(m.code === code && m.mode === 'W'));
    a.S.doc.marks.push({ id: `phone-old-${k}`, t, date: today, class: 'B3', code, lesson: '', mode: 'W', value: String(3 - k), reason: '', note: '', device: 'phone-old', edited: t });
  });
}, { codes: seated.slice(1, 5).map((s) => s.code), today });
await page.locator('.mode.m-w').click(); await page.waitForTimeout(150); // re-render
const old = await page.evaluate((codes) => codes.map((code) => { const a = window.__app; return (a.Mo.dayTally(a.S.doc, 'B3', a.Mo.localDate())[code] || {}).W; }), seated.slice(1, 5).map((s) => s.code));
const oldChips = await page.evaluate(() => [...document.querySelectorAll('.chip-t')].filter((e) => /c-w\d/.test(e.getAttribute('class'))).map((e) => e.textContent).sort().join(''));
check('old marks 3 2 1 0 still show as their own digit', old.join('') === '3210' && ['0', '1', '2', '3'].every((d) => oldChips.includes(d)), `${old.join(' ')} / chips ${oldChips}`);
const s1 = seated[1];
await seat(s1).tap(); await page.waitForTimeout(150);
const sub = await page.locator('.sheet-sub').textContent();
const cur = await page.locator('.sheet-panel .sbtn[aria-pressed="true"] .sletter').allTextContents();
check('an old mark opens the new menu with its digit marked', sub.endsWith('now 3') && cur.join('') === '3', `${sub} / pressed ${cur.join(',')}`);
await page.locator('.sheet-panel .cancel').click();

console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
