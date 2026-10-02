// Edit mode: a switch between "Move students" and "Move desks". Finger taps and drags, phone and tablet.
//   S=<folder> node tests/desks.mjs   (test server on 8123, fresh sample data in <folder>/drive1)
// The data file is changed first: the chart that opens in B3 gets single desks touching side by side
// (a pair), a group of 4 (two by two, edges touching), one 2-seat table, a desk at 45 degrees, and a
// few desks placed for the snap checks. Students not seated in it are taken off the roll, so the
// tray starts empty. Then, at each size:
// 1. Edit opens in Move students; the switch shows the mode; the grip beside each table is gone.
// 2. Move desks: every single desk drags by its own body, students stay on it, on the grid, in the room.
// 3. Move students: a drag still moves the student; a tap still selects a desk for the buttons.
// 4. Taps select and clear; a selection moves together; a desk that is not selected moves alone.
// 5. Snap on release: touching and lined up within 20 units; not at 40; never onto a desk; not at 45 degrees.
// 6. Rotate, Turn and Delete act on every selected desk; Add makes a single desk.
// 7. A 2-seat table moves as one. Pan and pinch never move a desk. A menu's closing tap reaches no desk.
// 8. The chart saves after Done and survives a reload. Board view: the desk follows the finger.
// The checks of what must not change (3 and the pan and pinch in 7) also require the switch to show
// the mode, so every check fails on a build without the switch.
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

// id, x, y, rot, seats. Desks are 150 wide and 90 deep; the room is 1060 by 680.
const DESKS = [
  ['P1', 150, 100, 0, 1], ['P2', 300, 100, 0, 1],                                   // a pair, side by side, touching
  ['G1', 150, 330, 180, 1], ['G2', 300, 330, 180, 1], ['G3', 150, 420, 0, 1], ['G4', 300, 420, 0, 1], // a group of 4
  ['T2', 225, 600, 0, 2],                                                           // a 2-seat table (old data)
  ['A', 560, 100, 0, 1],                                                            // the desk the snap checks move
  ['N', 800, 330, 0, 1], ['K', 652, 420, 0, 1],                                     // neighbours for the snap checks
  ['Sd', 600, 560, 0, 1], ['R', 850, 560, 45, 1],                                   // a still desk, and one at 45 degrees
];
const SINGLES = DESKS.filter((d) => d[4] === 1).map((d) => d[0]);
// Where each single desk is dragged to and back: clear of every snap (20 units) at the far end.
const OUT = { P1: [0, 70], P2: [0, 70], G1: [0, -70], G2: [0, -70], G3: [0, 60], G4: [0, 60], A: [0, 80], N: [100, 0], K: [-100, 0], Sd: [-110, 0], R: [0, -60] };
const grid = (v) => Math.round(v / 5) * 5;

function seed() {
  const d = JSON.parse(pristine);
  const now = new Date().toISOString();
  const codes = d.roster.B3.map((s) => s.code);
  const ch = d.charts.B3.find((c) => c.id === d.lastOpened.B3.chart);
  let i = 0;
  ch.tables = DESKS.map(([id, x, y, rot, n]) => ({ id, x, y, rot, seats: Array.from({ length: n }, () => codes[i++]) }));
  ch.updatedAt = now;
  const seated = new Set(ch.tables.flatMap((t) => t.seats));
  for (const s of d.roster.B3) if (!seated.has(s.code)) { s.active = false; s.updatedAt = now; }
  writeFileSync(`${DIR}/class-tracker-data.json`, JSON.stringify(d, null, 1));
  return { chartId: ch.id, room: d.room };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [VW, VH, t] of SIZES) {
  tag = t;
  const { chartId, room } = seed();
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, isMobile: VW < 700 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${t}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${t}: ${m.text()}`); });
  await page.goto(URL); await page.waitForTimeout(1200);
  await page.selectOption('#cls', 'B3'); await page.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(page);

  // ---------- reading the app ----------
  const st = () => page.evaluate(() => {
    const a = window.__app, S = a.S;
    const ch = S.draft || S.doc.charts.B3.find((c) => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart));
    const d = document.getElementById('e-move-desks'), s = document.getElementById('e-move-students');
    const on = (e) => e.getAttribute('aria-pressed') === 'true';
    const by = {};
    ch.tables.forEach((tb, i) => { by[tb.id] = { i, x: tb.x, y: tb.y, rot: tb.rot || 0, seats: tb.seats.slice() }; });
    return { editing: !!S.draft, mode: !d || !s || on(d) === on(s) ? null : on(d) ? 'desks' : 'students', by, n: ch.tables.length,
      sel: (S.selTables || []).map((i) => ch.tables[i] && ch.tables[i].id).sort(), outlined: document.querySelectorAll('.selmark').length,
      z: { ...a.view.z }, tray: [...document.querySelectorAll('.traychip')].map((e) => e.textContent), grips: document.querySelectorAll('.handle').length };
  });
  const pos = (s, id) => `${s.by[id].x},${s.by[id].y}`;
  const at = (s, id, x, y) => !!s.by[id] && s.by[id].x === x && s.by[id].y === y;
  // The desks named (or all but those named) are as they were: place, turn and students.
  const unchanged = (a, b, { only, except = [] } = {}) => (only || Object.keys(a.by)).filter((id) => !except.includes(id))
    .every((id) => b.by[id] && JSON.stringify({ ...a.by[id], i: 0 }) === JSON.stringify({ ...b.by[id], i: 0 }));
  const sheetOpen = () => page.evaluate(() => !document.getElementById('sheet').hidden);
  const closeAll = () => page.evaluate(() => { for (const id of ['sheet', 'modal']) { const e = document.getElementById(id); e.hidden = true; e.textContent = ''; } });
  const zoom = () => page.evaluate(() => window.__app.view.z.k);
  // The middle of a desk's card on screen (a seat of it), and whether a finger there lands on that desk.
  const deskPt = (id, seat = 0, fx = 0.5) => page.evaluate(([id, seat, fx]) => {
    const S = window.__app.S, ch = S.draft || S.doc.charts.B3.find((c) => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart));
    const i = ch.tables.findIndex((tb) => tb.id === id);
    const card = document.querySelector(`.seat[data-t="${i}"][data-i="${seat}"] .card`);
    if (!card) return null;
    const r = card.getBoundingClientRect(), x = r.x + r.width * fx, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y), s = hit && hit.closest('.seat');
    return { x, y, w: r.width, ok: !!s && +s.dataset.t === i };
  }, [id, seat, fx]);
  // A point of the room on screen, and what a finger there lands on.
  const roomPt = (x, y) => page.evaluate(([x, y]) => {
    const v = window.__app.view, b = document.getElementById('svg').getBoundingClientRect(), p = v.toView(x, y);
    const sx = b.left + v.z.tx + p.x * v.z.k, sy = b.top + v.z.ty + p.y * v.z.k, hit = document.elementFromPoint(sx, sy);
    return { x: sx, y: sy, floor: !!hit && !!hit.closest('#svg') && !hit.closest('.table') };
  }, [x, y]);

  // ---------- fingers ----------
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id || i + 1 })) });
  const tapAt = async (p) => { await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(250); };
  const tap = async (sel, text) => {
    const l = text ? page.locator(sel, { hasText: text }) : page.locator(sel);
    if (!(await l.count())) return false;
    await l.first().scrollIntoViewIfNeeded({ timeout: 5000 });
    const b = await l.first().boundingBox();
    await tapAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    return true;
  };
  // The finger rests before it lifts, as a hand does. (Lifted in mid-flick, the browser takes the
  // move for a fling and drops a tap that follows within a quarter of a second.)
  const lift = async () => { await page.waitForTimeout(150); await touch('touchEnd', []); await page.waitForTimeout(200); };
  // One finger from a point to another; `held` runs before the finger lifts.
  const drag = async (from, to, held) => {
    await touch('touchStart', [from]);
    for (let s = 1; s <= 6; s++) await touch('touchMove', [{ x: from.x + (to.x - from.x) * s / 6, y: from.y + (to.y - from.y) * s / 6 }]);
    if (held) await page.waitForTimeout(80); // the browser delivers a touch move with the next frame
    const out = held ? await held() : null;
    await lift();
    return out;
  };
  // A desk by room units (door view), pressed on its card.
  const dragDesk = async (id, [ux, uy], opts = {}) => {
    const p = await deskPt(id, opts.seat || 0, opts.fx || 0.5), k = await zoom();
    if (!p) return null;
    const held = await drag(p, { x: p.x + ux * k, y: p.y + uy * k }, opts.held);
    return { pressed: p.ok, held };
  };
  // A new Edit session on the chart as saved: leave (discarding) if one is open, fit, enter, pick the mode.
  const fresh = async (mode) => {
    await closeAll();
    if ((await st()).editing) { await tap('#edit'); if (await sheetOpen()) await tap('.sheet-panel .sbtn', 'Discard'); }
    await page.evaluate(() => window.__app.view.fit());
    await tap('#edit');
    if (mode === 'desks') await tap('#e-move-desks');
    return st();
  };
  const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, e.message.split('\n')[0]); } };

  // ---------- 1. the switch ----------
  await section('the switch', async () => {
    const s = await fresh('students');
    const look = await page.evaluate(() => ['e-move-students', 'e-move-desks', 'e-add'].map((id) => { const e = document.getElementById(id); if (!e) return null;
      const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { h: r.height, bg: c.backgroundColor, text: e.textContent.trim(), shown: r.width > 0 && r.bottom <= innerHeight + 0.5 && r.top >= 0 }; }));
    const [ms, md, add] = look;
    check('Edit opens in Move students, and the switch shows which mode is on', s.editing && s.mode === 'students' && !!ms && !!md && ms.text === 'Move students' && md.text === 'Move desks' &&
      ms.bg !== md.bg && ms.shown && md.shown && ms.h >= add.h - 1 && md.h >= add.h - 1 && ms.h >= 40, ms && md ? `on ${ms.bg}, off ${md.bg}; ${Math.round(ms.h)} px tall, + Desk ${Math.round(add.h)} px` : 'no switch');
    check('the grip beside each table is gone', s.mode !== null && s.grips === 0, `${s.grips} grips`);
    await page.screenshot({ path: `${S}/shots/desks-${t}-students.png` });
    await tap('#e-move-desks');
    const d = await st();
    check('a tap on "Move desks" turns that mode on, and selects or moves nothing', d.mode === 'desks' && d.sel.length === 0 && unchanged(s, d));
  });

  // ---------- 2. Move desks: every single desk ----------
  await section('every desk', async () => {
    const s0 = await fresh('desks');
    const moved = {}, alone = {}, back = {}, onDesk = {};
    for (const id of SINGLES) {
      const a = await st(), v = OUT[id];
      const r = await dragDesk(id, v);
      const b = await st();
      const want = [grid(a.by[id].x + v[0]), grid(a.by[id].y + v[1])];
      onDesk[id] = !!r && r.pressed;
      moved[id] = b.mode === 'desks' && at(b, id, ...want) && b.by[id].seats.join() === a.by[id].seats.join();
      alone[id] = unchanged(a, b, { except: [id] });
      await dragDesk(id, [-v[0], -v[1]]);
      back[id] = at(await st(), id, grid(want[0] - v[0]), grid(want[1] - v[1]));
    }
    const ok = SINGLES.filter((id) => onDesk[id] && moved[id] && alone[id] && back[id]);
    check(`in Move desks every single desk can be pressed and dragged, and dragged back (${SINGLES.length} desks)`, ok.length === SINGLES.length, `${ok.length} of ${SINGLES.length}${ok.length < SINGLES.length ? '; not: ' + SINGLES.filter((id) => !ok.includes(id)).join(' ') : ''}`);
    check('each desk of a touching pair moves on its own, and the other stays', ['P1', 'P2'].every((id) => moved[id] && alone[id]));
    check('each desk of the group of 4 moves on its own', ['G1', 'G2', 'G3', 'G4'].every((id) => moved[id] && alone[id]));
    const s1 = await st();
    check('students stay on their desks while the desks move', s1.mode === 'desks' && SINGLES.every((id) => moved[id]) && Object.keys(s0.by).every((id) => s1.by[id].seats.join() === s0.by[id].seats.join()));
    // Pressed near its left end, the desk moves by what the finger moved: its centre does not jump to the finger.
    const a = await st();
    const r = await dragDesk('A', [60, 40], { fx: 0.15 });
    const b = await st();
    check('a desk follows the finger from the point where it was pressed, on the 5-unit grid', b.mode === 'desks' && !!r && r.pressed && at(b, 'A', a.by.A.x + 60, a.by.A.y + 40), `${pos(a, 'A')} -> ${pos(b, 'A')}`);
    await dragDesk('A', [0, -250]);
    const c = await st();
    check('a desk stays inside the room', c.mode === 'desks' && at(c, 'A', b.by.A.x, 40), `${pos(b, 'A')} -> ${pos(c, 'A')}`);
  });

  // ---------- 3. Move students ----------
  await section('Move students', async () => {
    const a = await fresh('students');
    const p1 = await deskPt('P1'), pa = await deskPt('A');
    await drag(p1, pa);
    const b = await st();
    check('in Move students a drag moves the student, not the desk', b.mode === 'students' && b.by.P1.seats[0] === a.by.A.seats[0] && b.by.A.seats[0] === a.by.P1.seats[0] &&
      at(b, 'P1', a.by.P1.x, a.by.P1.y) && at(b, 'A', a.by.A.x, a.by.A.y) && unchanged(a, b, { except: ['P1', 'A'] }));
    await tapAt(await deskPt('N'));
    await tap('#e-turn');
    const c = await st();
    check('in Move students a tap on a desk selects it for the buttons (Turn turns that desk only)', c.mode === 'students' && c.sel.join() === 'N' && c.by.N.rot === 180 && at(c, 'N', b.by.N.x, b.by.N.y) && unchanged(b, c, { except: ['N'] }), `selected ${c.sel.join(' ')}; turn ${c.by.N.rot}`);
  });

  // ---------- 4. selecting, and moving several ----------
  await section('selection', async () => {
    const a = await fresh('desks');
    await tapAt(await deskPt('P1'));
    const s1 = await st();
    await tapAt(await deskPt('G1'));
    const s2 = await st();
    check('a tap selects a desk; a tap on a second desk adds it; both are outlined', s2.mode === 'desks' && s1.sel.join() === 'P1' && s1.outlined === 1 && s2.sel.join() === 'G1,P1' && s2.outlined === 2, `${s1.sel.join(' ')} (${s1.outlined} outlined), then ${s2.sel.join(' ')} (${s2.outlined})`);
    await tapAt(await deskPt('P1'));
    const s3 = await st();
    const floor = await roomPt(500, 250);
    await tapAt(floor);
    const s4 = await st();
    check('a tap on a selected desk clears it; a tap on empty floor clears the selection; no tap moves a desk', s4.mode === 'desks' && s3.sel.join() === 'G1' && floor.floor && s4.sel.length === 0 && s4.outlined === 0 && unchanged(a, s4), `${s3.sel.join(' ')}, then ${s4.sel.length} selected`);

    for (const id of ['G1', 'G2', 'G3', 'G4']) await tapAt(await deskPt(id));
    await page.screenshot({ path: `${S}/shots/desks-${t}-four-selected.png` });
    await dragDesk('G3', [200, -100]);
    const b = await st();
    const group = ['G1', 'G2', 'G3', 'G4'];
    check('dragging a selected desk moves every selected desk, keeping their places relative to each other', b.mode === 'desks' && group.every((id) => at(b, id, a.by[id].x + 200, a.by[id].y - 100)) && unchanged(a, b, { except: group }) && b.sel.join() === 'G1,G2,G3,G4',
      group.map((id) => `${id} ${pos(b, id)}`).join('; '));
    await dragDesk('A', [150, 0]);
    const c = await st();
    check('dragging a desk that is not selected moves that desk only, and it becomes the only one selected', c.mode === 'desks' && at(c, 'A', a.by.A.x + 150, a.by.A.y) && unchanged(b, c, { except: ['A'] }) && c.sel.join() === 'A', `A ${pos(c, 'A')}; selected ${c.sel.join(' ')}`);
    await tapAt(await roomPt(500, 480));
    await tapAt(await deskPt('P1')); await tapAt(await deskPt('P2'));
    await dragDesk('P1', [-130, 0]);
    const e = await st();
    check('a group stays inside the room as a whole, still in its shape', e.mode === 'desks' && at(e, 'P1', 40, 100) && at(e, 'P2', 190, 100), `P1 ${pos(e, 'P1')}, P2 ${pos(e, 'P2')}`);
  });

  // ---------- 5. snap ----------
  await section('snap', async () => {
    const a = await fresh('desks');
    // A is dropped 15 units right of N's right edge, 10 units off its line.
    const r = await dragDesk('A', [405, 240], { held: st });
    const b = await st();
    const touching = b.by.A.x - 75 === b.by.N.x + 75 && b.by.A.y === b.by.N.y;
    check("a desk dropped 15 units from a neighbour's edge ends touching it and lined up with it", b.mode === 'desks' && at(b, 'A', 950, 330) && touching && unchanged(a, b, { except: ['A'] }), `dropped at ${r && r.held ? pos(r.held, 'A') : '?'}, ends at ${pos(b, 'A')}; N ${pos(b, 'N')}`);
    check('the snap happens on release, not while the finger is down', b.mode === 'desks' && !!r && !!r.held && at(r.held, 'A', 965, 340) && at(b, 'A', 950, 330), `held at ${r && r.held ? pos(r.held, 'A') : '?'}, released at ${pos(b, 'A')}`);
    await page.screenshot({ path: `${S}/shots/desks-${t}-snapped.png` });
    await dragDesk('A', [40, 0]);
    const c = await st();
    check('a desk dropped 40 units from the edge stays where it was dropped', c.mode === 'desks' && at(c, 'A', 990, 330), pos(c, 'A'));
    // Behind N, 15 units off its edge and 20 off its line: lining up would put A 2 units over K.
    await dragDesk('A', [-170, 105]);
    const d = await st();
    const free = await page.evaluate(() => { const a = window.__app, tb = a.S.draft.tables, f = (id) => tb.find((x) => x.id === id); return a.Mo.snapShift ? a.Mo.snapShift([f('A')], [f('N')], a.S.doc.room) : null; });
    check('a snap that would put the desk on another does not happen: the desk stays where it was dropped', d.mode === 'desks' && at(d, 'A', 820, 435) && !!free && free.dx === -20 && free.dy === -15 && unchanged(c, d, { except: ['A'] }),
      `${pos(d, 'A')}; with K out of the way it would shift by ${free ? free.dx + ',' + free.dy : '?'}`);
    // R, at 45 degrees, is dropped where a square desk would snap to Sd.
    await dragDesk('R', [-85, 10]);
    const e = await st();
    const square = await page.evaluate(() => { const a = window.__app, tb = a.S.draft.tables, f = (id) => tb.find((x) => x.id === id); return a.Mo.snapShift ? a.Mo.snapShift([{ ...f('R'), rot: 0 }], [f('Sd')], a.S.doc.room) : null; });
    check('a desk at 45 degrees does not snap', e.mode === 'desks' && e.by.R.rot === 45 && at(e, 'R', 765, 570) && !!square && square.dx === -15 && square.dy === -10, `${pos(e, 'R')}; a square desk there would shift by ${square ? square.dx + ',' + square.dy : '?'}`);
  });

  // ---------- 6. the buttons act on every selected desk ----------
  await section('buttons', async () => {
    const a = await fresh('desks');
    for (const id of ['P1', 'P2', 'A']) await tapAt(await deskPt(id));
    await tap('#e-turn');
    const b = await st();
    await tap('#e-right');
    const c = await st();
    const three = ['P1', 'P2', 'A'];
    check('rotate and Turn act on every selected desk, each turning in place', c.mode === 'desks' && three.every((id) => b.by[id].rot === (a.by[id].rot + 180) % 360 && c.by[id].rot === (a.by[id].rot + 195) % 360 && at(c, id, a.by[id].x, a.by[id].y)) && unchanged(a, c, { except: three }),
      three.map((id) => `${id} ${a.by[id].rot}>${b.by[id].rot}>${c.by[id].rot}`).join('; '));
    await tapAt(await roomPt(500, 250));
    await tapAt(await deskPt('G1')); await tapAt(await deskPt('G2'));
    await tap('#e-del');
    const d = await st();
    const gone = [...a.by.G1.seats, ...a.by.G2.seats];
    check('Delete removes every selected desk; their students go back to the tray', d.mode === 'desks' && d.n === a.n - 2 && !d.by.G1 && !d.by.G2 && a.tray.length === 0 && d.tray.length === 2 && d.sel.length === 0 && unchanged(c, d, { except: ['G1', 'G2'] }),
      `${a.n} -> ${d.n} desks; tray ${a.tray.length} -> ${d.tray.length}${gone.every((x) => d.tray.includes(x)) ? '' : ' (other students)'}`);
    await tap('#e-add');
    const e = await st();
    const added = Object.keys(e.by).find((id) => !d.by[id]);
    check('Add makes a single desk, selected, in the middle of the room', e.mode === 'desks' && e.n === d.n + 1 && !!added && e.by[added].seats.length === 1 && e.by[added].seats[0] === null && at(e, added, room.w / 2, room.h / 2) && e.sel.join() === added,
      added ? `${e.by[added].seats.length} seat at ${pos(e, added)}` : 'no new desk');
  });

  // ---------- 7. a 2-seat table; pan and pinch; a menu's closing tap ----------
  await section('table, pan, pinch, menu', async () => {
    const a = await fresh('desks');
    const r = await dragDesk('T2', [100, -40], { seat: 1 });
    const b = await st();
    check('a 2-seat table moves as one, by any part of it, with both students', b.mode === 'desks' && !!r && r.pressed && at(b, 'T2', a.by.T2.x + 100, a.by.T2.y - 40) && b.by.T2.seats.join() === a.by.T2.seats.join() && b.by.T2.seats.length === 2 && unchanged(a, b, { except: ['T2'] }), `${pos(a, 'T2')} -> ${pos(b, 'T2')}`);

    const f = await roomPt(500, 250);
    await drag(f, { x: f.x + 40, y: f.y + 30 });
    const c = await st();
    check('one finger on empty floor still pans, and no desk moves', c.mode === 'desks' && f.floor && Math.abs(c.z.tx - b.z.tx - 40) < 1 && Math.abs(c.z.ty - b.z.ty - 30) < 1 && c.z.k === b.z.k && unchanged(b, c) && c.sel.join() === b.sel.join(),
      `${f.floor ? 'floor' : 'not floor'}; chart moved ${Math.round(c.z.tx - b.z.tx)},${Math.round(c.z.ty - b.z.ty)} px; selection ${c.sel.join() === b.sel.join() ? 'as it was' : 'changed'}`);

    // Both fingers on desks, spreading.
    const f1 = await deskPt('P1'), f2 = await deskPt('A');
    await touch('touchStart', [f1, f2]);
    for (let s = 1; s <= 6; s++) await touch('touchMove', [{ x: f1.x - s * 6, y: f1.y }, { x: f2.x + s * 6, y: f2.y }]);
    await lift();
    const d = await st();
    check('two fingers still pinch-zoom, and a pinch on two desks moves neither', d.mode === 'desks' && f1.ok && f2.ok && d.z.k > c.z.k * 1.1 && unchanged(b, d) && d.sel.join() === b.sel.join(), `zoom ${c.z.k.toFixed(3)} -> ${d.z.k.toFixed(3)}; fingers on desks: ${f1.ok && f2.ok}; selection ${d.sel.join() === b.sel.join() ? 'as it was' : 'changed'}`);

    // One finger has dragged N a little when a second finger lands: the desk goes back.
    await page.evaluate(() => window.__app.view.fit());
    const n = await deskPt('N'), k = await zoom(), g = await roomPt(500, 250);
    await touch('touchStart', [n]);
    for (let s = 1; s <= 4; s++) await touch('touchMove', [{ x: n.x + s * 15 * k, y: n.y + s * 10 * k }]);
    await page.waitForTimeout(80);
    const mid = await st();
    const n2 = { x: n.x + 60 * k, y: n.y + 40 * k };
    await touch('touchStart', [n2, g]);
    for (let s = 1; s <= 4; s++) await touch('touchMove', [{ x: n2.x + s * 5, y: n2.y }, { x: g.x - s * 5, y: g.y }]);
    await lift();
    const e = await st();
    check('a second finger landing during a drag puts the desk back where it was', e.mode === 'desks' && at(mid, 'N', b.by.N.x + 60, b.by.N.y + 40) && unchanged(b, e), `N ${pos(b, 'N')} -> ${pos(mid, 'N')} -> ${pos(e, 'N')}`);

    // The chart menu is open over the chart; a tap on the grey beside it closes it. A desk is under that tap.
    await page.evaluate(() => window.__app.view.fit());
    const g0 = await st();
    await tap('#e-menu');
    const open = await sheetOpen();
    const under = await deskPt('A');
    const cover = await page.evaluate(([x, y]) => document.elementFromPoint(x, y) === document.getElementById('sheet'), [under.x, under.y]);
    await tapAt(under);
    const h = await st();
    check('the tap that closes a menu never reaches the desk underneath', h.mode === 'desks' && open && cover && !(await sheetOpen()) && h.sel.join() === g0.sel.join() && !h.sel.includes('A') && unchanged(b, h), `menu ${open ? 'opened' : 'did not open'}${cover ? ' over the desk' : ''}; selection ${g0.sel.join(' ') || 'none'} -> ${h.sel.join(' ') || 'none'}`);
  });

  // ---------- 8. save, reload, board view ----------
  await section('save and reload', async () => {
    const a = await fresh('desks');
    await dragDesk('A', [0, 80]);
    await dragDesk('P1', [0, 70]);
    const b = await st();
    await tap('#edit');
    await tap('.sheet-panel .sbtn', 'Save (overwrite');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__app.sync(true));
    await page.waitForTimeout(400);
    const file = JSON.parse(readFileSync(`${DIR}/class-tracker-data.json`, 'utf8')).charts.B3.find((c) => c.id === chartId).tables;
    const inFile = (id) => file.find((x) => x.id === id);
    const s = await st();
    check('the chart saves after Done: the new places are in the data file', b.mode === 'desks' && !s.editing && at(b, 'A', a.by.A.x, a.by.A.y + 80) && inFile('A').x === a.by.A.x && inFile('A').y === a.by.A.y + 80 && inFile('P1').y === a.by.P1.y + 70 && file.length === a.n &&
      file.every((x) => x.seats.join() === a.by[x.id].seats.join()), `A ${inFile('A').x},${inFile('A').y}; P1 ${inFile('P1').x},${inFile('P1').y}`);
    await page.reload(); await page.waitForTimeout(1200);
    const c = await st();
    const shown = await deskPt('A'), where = await roomPt(a.by.A.x, a.by.A.y + 80);
    check('the places survive a reload', b.mode === 'desks' && !c.editing && at(c, 'A', a.by.A.x, a.by.A.y + 80) && at(c, 'P1', a.by.P1.x, a.by.P1.y + 70) && !!shown && Math.abs(shown.x - where.x) < 2 && Math.abs(shown.y - where.y) < 2, `A ${pos(c, 'A')}, P1 ${pos(c, 'P1')}`);

    // Board view: the room is shown turned around, and the desk still goes where the finger goes.
    await tap('#view');
    const d = await fresh('desks');
    const p = await deskPt('A');
    await drag(p, { x: p.x + 30, y: p.y - 20 });
    const e = await st();
    const q = await deskPt('A'), k = await zoom();
    check('in board view the desk follows the finger too', e.mode === 'desks' && p.ok && e.by.A.x < d.by.A.x && e.by.A.y > d.by.A.y && Math.abs(q.x - (p.x + 30)) <= 2.5 * k + 1 && Math.abs(q.y - (p.y - 20)) <= 2.5 * k + 1,
      `${pos(d, 'A')} -> ${pos(e, 'A')}; on screen ${Math.round(q.x - p.x)},${Math.round(q.y - p.y)} px`);
    await tap('#edit'); if (await sheetOpen()) await tap('.sheet-panel .sbtn', 'Discard');
    await tap('#view');
  });

  await ctx.close();
}
console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
for (const t of SIZES.map((s) => s[2])) console.log(`  ${t}: ${results.filter((r) => r.startsWith('PASS') && r.includes(`[${t}]`)).length}/${results.filter((r) => r.includes(`[${t}]`)).length}`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
