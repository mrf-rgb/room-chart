import { chromium } from 'playwright-core';
const S = process.env.S;
const VW = Number(process.env.VW || 1280), VH = Number(process.env.VH || 800), TAG = process.env.TAG || 'tablet';
const URL = 'http://localhost:8123/?nosw=1&testdrive=http://localhost:8123/api';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = []; const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); };
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, isMobile: VW < 700 });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL); await page.waitForTimeout(1200);
const seat = (t, i) => page.locator(`.seat[data-t="${t}"][data-i="${i}"]`);
const shot = (n) => page.screenshot({ path: `${S}/shots/${TAG}-${n}.png` });
const state = () => page.evaluate(() => { const S = window.__app.S; return { marks: S.doc.marks.length, charts: S.doc.charts[S.meta.cls].filter(c => !c.deleted).map(c => c.name), mode: S.meta.mode }; });
const sheetBtn = (text) => page.locator('.sheet-panel .sbtn', { hasText: text });
const tapSheet = async (text) => { await sheetBtn(text).click(); await page.waitForTimeout(150); };

await page.selectOption('#cls', 'B3'); await page.waitForTimeout(300);
const [ft, fi] = await page.evaluate(() => { const S = window.__app.S; const ch = S.doc.charts.B3.find(c => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart)); for (let t = 0; t < ch.tables.length; t++) for (let i = 0; i < ch.tables[t].seats.length; i++) if (ch.tables[t].seats[i]) return [t, i]; });
const other = await page.evaluate(([ft]) => { const S = window.__app.S; const ch = S.doc.charts.B3.find(c => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart)); for (let t = ft + 1; t < ch.tables.length; t++) for (let i = 0; i < ch.tables[t].seats.length; i++) if (ch.tables[t].seats[i]) return [t, i]; }, [ft]);

// worksheet
await seat(ft, fi).click();
const wb = await page.locator('.sheet-panel .sheet-buttons .sbtn').allTextContents();
check('worksheet menu: 5 4 3 2 1 0 and Absent', wb.length === 7 && wb[6].includes('Absent') && wb.slice(0, 6).map((x) => x[0]).join('') === '543210', wb.join('|'));
await shot('worksheet-menu');
await tapSheet('all done'); await page.waitForTimeout(150);
check('worksheet chip 5 on the seat', await page.locator('.chip-t.c-w5').count() === 1);
await seat(ft, fi).click(); await tapSheet('about half');
let st = await state();
check('second worksheet tap changes the mark (no second mark)', st.marks === 1 && await page.locator('.chip-t.c-w3').count() === 1, JSON.stringify(st));

// reasons
await page.locator('.mode.m-pos').click();
for (let k = 0; k < 2; k++) { await seat(ft, fi).click(); await tapSheet('on task'); }
await page.locator('.mode.m-neg').click();
await seat(ft, fi).click();
const nb = await page.locator('.sheet-panel .sheet-buttons .sbtn').allTextContents();
check('negative menu: reasons then Absent at the end', nb.length === 6 && nb[5].includes('Absent'), nb.join('|'));
await shot('negative-menu');
await tapSheet('phone');
await page.locator('.mode.m-part').click();
await seat(ft, fi).click(); await tapSheet('board work');
check('badge: +2, minus, P, 2 chips', await page.locator('.chip-t.c-pos', { hasText: '+2' }).count() === 1 && await page.locator('.chip-t.c-neg').count() === 1 && await page.locator('.chip-t.c-part').count() === 1 && await page.locator('.chip-t.c-w3').count() === 1);
await shot('badges');

// attendance
await page.locator('.mode.m-att').click(); await page.waitForTimeout(100);
check('opening Attendance mode stores a roll entry', await page.evaluate(() => window.__app.S.doc.rolls.length) === 1);
await seat(...other).click(); await page.waitForTimeout(150);
check('attendance tap greys the seat', await seat(...other).evaluate((e) => e.classList.contains('absent')));
await seat(...other).click(); await page.waitForTimeout(150);
check('second attendance tap undoes', !(await seat(...other).evaluate((e) => e.classList.contains('absent'))));
await seat(...other).click(); await page.waitForTimeout(100);
await page.locator('.mode.m-w').click();
await seat(...other).click();
check('worksheet round skips an absent student (offers Mark present only)', await page.locator('.sheet-panel', { hasText: 'Mark present' }).count() === 1 && await sheetBtn('all done').count() === 0);
await page.locator('.sheet-panel .cancel').click();
await page.locator('.mode.m-pos').click();
const third = [other[0], other[1] === 0 ? 1 : 0];
if (await page.evaluate(([t, i]) => { const S = window.__app.S; const ch = S.doc.charts.B3.find(c => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart)); return !!ch.tables[t].seats[i]; }, third)) {
  await seat(...third).click(); await tapSheet('Absent'); await page.waitForTimeout(100);
  check('Absent from a reason menu', await seat(...third).evaluate((e) => e.classList.contains('absent')));
}
await shot('attendance');

// long press
const box = await seat(ft, fi).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
await page.waitForTimeout(200);
const dvItems = await page.locator('.dv-list li').count();
check('long press opens the day view with every mark', dvItems === 5, `items ${dvItems}`);
await page.locator('.dayview .pnote').fill('left early');
await page.locator('.dayview button', { hasText: 'Save note' }).click(); await page.waitForTimeout(250);
await page.locator('.dayview input.pinput').fill('Sam');
await page.locator('.dayview button', { hasText: 'Save name' }).click(); await page.waitForTimeout(200);
await page.locator('.dv-list li').first().locator('button', { hasText: 'Change' }).click();
await tapSheet('started'); await page.waitForTimeout(100);
check('day view: a mark can be changed', await page.evaluate(() => window.__app.S.doc.marks.find(m => m.mode === 'W').value) === '1');
await shot('dayview');
await page.locator('.modal-head .tbtn').click(); await page.waitForTimeout(150);
check('card shows the name used after it is set', await page.locator('.labels .name', { hasText: 'Sam' }).count() === 1);

// summary, history
await page.locator('#summary').click(); await page.waitForTimeout(200);
check('day summary lists the class with chips and absences', await page.locator('.grid-table tbody tr').count() === 24 && await page.locator('.grid-table .chipx.c-abs').count() >= 1);
await shot('summary'); await page.locator('.modal-head .tbtn').click();
await page.locator('#history').click(); await page.waitForTimeout(200);
check('attendance history: today, absences grey', await page.locator('.history tbody tr').count() === 1 && await page.locator('.abs-cell').count() >= 1);
await shot('history'); await page.locator('.modal-head .tbtn').click();

// picker
const absentSet = await page.evaluate(() => { const a = window.__app; return [...a.Mo.absentCodes(a.S.doc, 'B3', a.Mo.localDate())]; });
let pickedAbsent = false; const seen = new Set();
for (let k = 0; k < 40; k++) { await page.locator('#pick').click(); const p = await page.evaluate(() => window.__app.S.picked); seen.add(p); if (absentSet.includes(p)) pickedAbsent = true; }
check('random picker never picks an absent student (40 picks)', !pickedAbsent && absentSet.length >= 1, `absent ${absentSet.length}, distinct picks ${seen.size}`);
await shot('picker');

// lesson
await page.locator('#lesson').click(); await page.locator('.sheet-panel input').fill('M8-U1-D13'); await page.locator('.sheet-panel .sbtn.primary').click();
await page.waitForTimeout(100);
const lessonOk = await page.evaluate(() => window.__app.S.doc.marks.filter(m => m.class === 'B3').every(m => m.lesson === 'M8-U1-D13'));
check("lesson label set for the day and on today's marks", lessonOk && (await page.locator('#lesson').textContent()) === 'M8-U1-D13');

// views
await page.locator('#view').click(); await page.waitForTimeout(200); await shot('board-view');
check('board view: board at the bottom', Number(await page.locator('.board').getAttribute('y')) > 600);
await page.locator('#view').click();
await page.selectOption('#chart', 'reteach-0923'); await page.waitForTimeout(200); await shot('reteach');

// edit
await page.selectOption('#chart', 'regular'); await page.waitForTimeout(200);
const before = await page.evaluate(() => JSON.stringify(window.__app.S.doc.charts.B3.find(c => c.id === 'regular').tables));
await page.locator('#edit').click();
check('edit bar and tray shown; mode bar hidden', await page.locator('#editbar').isVisible() && await page.locator('#tray').isVisible() && !(await page.locator('#modes').isVisible()));
const s00 = await page.evaluate(() => window.__app.S.draft.tables[0].seats.slice());
await seat(0, 0).click(); await seat(0, 1).click();
const s00b = await page.evaluate(() => window.__app.S.draft.tables[0].seats.slice());
check('tap two seats swaps them', s00[0] === s00b[1] && s00[1] === s00b[0]);
await seat(1, 0).click(); await page.locator('#e-turn').click(); await page.locator('#e-right').click();
const hb = await page.locator('.handle').nth(4).boundingBox();
const t4 = await page.evaluate(() => ({ ...window.__app.S.draft.tables[4] }));
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + 60, hb.y + 60, { steps: 6 }); await page.mouse.up();
const t4b = await page.evaluate(() => ({ ...window.__app.S.draft.tables[4] }));
check('drag a table by its grip', t4b.x !== t4.x && t4b.y !== t4.y, `${t4.x},${t4.y} -> ${t4b.x},${t4b.y}`);
const a2 = await page.evaluate(() => window.__app.S.draft.tables[2].seats.slice());
const sb = await seat(2, 0).boundingBox(), tb2 = await seat(2, 1).boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down();
await page.mouse.move(tb2.x + tb2.width / 2, tb2.y + tb2.height / 2, { steps: 8 }); await page.mouse.up();
const a2b = await page.evaluate(() => window.__app.S.draft.tables[2].seats.slice());
check('drag a student to another seat', a2[0] === a2b[1] && a2[1] === a2b[0]);
await page.locator('#e-add').click(); await page.locator('#e-seat-plus').click();
await seat(0, 0).click(); await page.locator('#e-seat-minus').click();
const trayCount = await page.locator('.traychip').count();
check('removing an occupied seat puts the student in the tray', trayCount >= 1, `tray ${trayCount}`);
await page.locator('.traychip').first().click(); await seat(15, 2).click();
await shot('edit');
const draft = await page.evaluate(() => window.__app.S.draft.tables);
check('turn around + one 15 degree step = 195', draft[1].rot === 195, `rot ${draft[1].rot}`);
check('table added with 3 seats, tray student placed', draft.length === 16 && draft[15].seats.length === 3 && !!draft[15].seats[2]);
await page.locator('#edit').click();
const lb = (await page.locator('.sheet-panel .sbtn').allTextContents()).join('|');
check('leaving edit asks Save / Save as new / Discard', lb.includes('Save (overwrite') && lb.includes('Save as new') && lb.includes('Discard'), lb);
await tapSheet('Save as new');
await page.locator('.sheet-panel input').fill('Groups test'); await page.locator('.sheet-panel .sbtn.primary').click();
await page.waitForTimeout(200);
st = await state();
const after = await page.evaluate(() => JSON.stringify(window.__app.S.doc.charts.B3.find(c => c.id === 'regular').tables));
check('save as new keeps the old chart unchanged', st.charts.includes('Groups test') && before === after, st.charts.join(','));
const chk = await page.evaluate(() => { const a = window.__app; const ch = a.S.doc.charts.B3.find(c => c.name === 'Groups test'); return a.Mo.checkChart(a.S.doc, 'B3', ch); });
check('saved chart: every code exactly once', chk.ok, JSON.stringify(chk));
await page.locator('#edit').click(); await page.locator('#e-add').click(); await page.locator('#edit').click();
await tapSheet('Discard');
check('discard leaves the chart as saved', await page.evaluate(() => window.__app.S.doc.charts.B3.find(c => c.name === 'Groups test').tables.length) === 16);
await page.locator('#edit').click(); await seat(0, 0).click(); await page.locator('#e-turn').click(); await page.locator('#edit').click();
await tapSheet('Save (overwrite'); await page.waitForTimeout(100);
check('save overwrites this chart', await page.evaluate(() => window.__app.S.doc.charts.B3.find(c => c.name === 'Groups test').tables[0].rot) === 180);
await page.locator('#edit').click(); await page.locator('#e-menu').click(); await tapSheet('Rename');
await page.locator('.sheet-panel input').fill('Groups B'); await page.locator('.sheet-panel .sbtn.primary').click();
check('rename', (await state()).charts.includes('Groups B'));
await page.locator('#e-menu').click(); await tapSheet('Delete');
check('delete asks for confirmation', await page.locator('.sheet-panel', { hasText: 'Delete "Groups B"?' }).count() === 1);
await page.locator('.sheet-panel .sbtn.danger').click(); await page.waitForTimeout(150);
st = await state();
check('delete removes the chart', !st.charts.includes('Groups B') && st.charts.length === 2, st.charts.join(','));
await page.evaluate(() => { window.__app.S.doc.charts.B3.find(c => c.id === 'reteach-0923').deleted = true; });
await page.locator('#edit').click(); await page.locator('#e-menu').click(); await tapSheet('Delete');
await page.waitForTimeout(150);
check("a class's last chart cannot be deleted", (await page.locator('#toast').textContent()).includes('cannot be deleted'));
await page.evaluate(() => { window.__app.S.doc.charts.B3.find(c => c.id === 'reteach-0923').deleted = false; });
await page.locator('#edit').click();
await page.selectOption('#chart', '__new');
await tapSheet('B1 M8 Honors · Reteach 9/23');
await page.locator('.sheet-panel input').fill('From B1 reteach'); await page.locator('.sheet-panel .sbtn.primary').click();
await page.waitForTimeout(150);
await shot('new-from');
await page.locator('#edit').click(); await page.locator('.sheet-panel .sbtn.primary').click(); await page.waitForTimeout(150);
const nf = await page.evaluate(() => { const a = window.__app; const ch = a.S.doc.charts.B3.find(c => c.name === 'From B1 reteach'); return ch ? a.Mo.checkChart(a.S.doc, 'B3', ch) : null; });
check('new chart from another class: tables copied, this class seated once each', nf && nf.ok, JSON.stringify(nf));

// pinch zoom (two touch points via CDP)
const cdp = await ctx.newCDPSession(page);
const sv = await page.locator('#svg').boundingBox();
const cx = sv.x + sv.width / 2, cy = sv.y + sv.height / 2;
const k0 = await page.evaluate(() => document.querySelector('.vp').getAttribute('transform'));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
for (let s = 1; s <= 6; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 40 - s * 20, y: cy, id: 1 }, { x: cx + 40 + s * 20, y: cy, id: 2 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const k1 = await page.evaluate(() => document.querySelector('.vp').getAttribute('transform'));
const sc = (t) => Number(/scale\(([\d.]+)\)/.exec(t)[1]);
check('pinch-zoom enlarges the chart', sc(k1) > sc(k0) * 1.8, `${sc(k0).toFixed(2)} -> ${sc(k1).toFixed(2)}`);
await shot('pinched');
await page.locator('#fit').click();

await page.waitForTimeout(5500);
const pill = await page.locator('#sync').textContent();
check('sync pill says Synced once written', pill.includes('Synced'), pill);
console.log(results.join('\n'));
console.log(`${results.filter(r => r.startsWith('PASS')).length}/${results.length} passed`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
