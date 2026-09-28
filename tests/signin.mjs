// Quiet sign-in renewal, on the real Google code path (drive.js GoogleDrive) with stand-ins for
// Google's sign-in script and the Drive API, routed inside the test browser. The stand-in opens
// "Google's window" only during a tap, as a browser's popup blocker does; prompt 'none' gets a token
// with no screen when allowed, or 'interaction_required'.
//   S=<folder> node tests/signin.mjs   (test server on 8123, fresh sample data in <folder>/drive1)
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
const S = process.env.S;
const DIR = `${S}/drive1`;
const APP = 'http://localhost:8123/?nosw=1';
const ACCOUNT = 'teacher@example.org';
const results = []; const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
const file = () => JSON.parse(readFileSync(`${DIR}/class-tracker-data.json`, 'utf8'));
const inFile = (id) => file().marks.some((m) => m.id === id);

const FAKE_GIS = `
window.google = window.google || {};
google.accounts = { oauth2: { initTokenClient(cfg) {
  const client = { callback: cfg.callback, error_callback: cfg.error_callback, requestAccessToken(o = {}) {
    const g = window.__gis;
    const active = navigator.userActivation ? navigator.userActivation.isActive : null;
    window.__gisLog({ prompt: o.prompt, hint: o.login_hint || o.hint || '', active });
    setTimeout(() => {
      if (!active) return client.error_callback && client.error_callback({ type: 'popup_failed_to_open' });
      if (o.prompt === 'none' && !g.allowQuiet) return client.callback({ error: 'interaction_required' });
      g.n++; client.callback({ access_token: 'tok-' + g.n, expires_in: g.expiresIn });
    }, 30);
  } };
  return client;
} } };`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const gisLog = [];
await page.exposeFunction('__gisLog', (e) => { gisLog.push(e); });
await page.addInitScript(() => {
  window.__gis = Object.assign({ n: 0, expiresIn: 3600, allowQuiet: true }, JSON.parse(sessionStorage.getItem('gis') || '{}'));
});
await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
const drive = [];
await page.route('https://www.googleapis.com/**', async (r) => {
  const req = r.request(), u = new URL(req.url());
  drive.push(`${req.method()} ${u.pathname}`);
  if (!/^Bearer tok-\d+$/.test(req.headers()['authorization'] || '')) return r.fulfill({ status: 401, body: '{}' });
  const json = (o) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
  if (u.pathname === '/drive/v3/about') return json({ user: { emailAddress: ACCOUNT } });
  if (u.pathname === '/drive/v3/files') {
    const name = /name='([^']+)'/.exec(u.searchParams.get('q') || '')[1];
    return json({ files: ['class-tracker-data.json', 'class-tracker-inbox.json'].includes(name) ? [{ id: name, name }] : [] });
  }
  const id = decodeURIComponent(u.pathname.split('/').pop());
  if (req.method() === 'PATCH') { writeFileSync(`${DIR}/${id}`, req.postData()); return json({ id }); }
  return r.fulfill({ contentType: 'application/json', body: readFileSync(`${DIR}/${id}`, 'utf8') });
});
const pill = () => page.locator('#sync').textContent();
const seats = () => page.evaluate(() => { const S = window.__app.S; const ch = S.doc.charts.B3.find((c) => c.id === (S.meta.chartBy.B3 || S.doc.lastOpened.B3.chart)); const out = []; ch.tables.forEach((t, ti) => t.seats.forEach((c, i) => { if (c) out.push([ti, i]); })); return out; });
// A positive mark by finger; returns the new mark's id.
async function tapMark(k) {
  const [t, i] = (await seats())[k];
  await page.locator(`.seat[data-t="${t}"][data-i="${i}"]`).tap(); await page.waitForTimeout(250);
  await page.locator('.sheet-panel .sbtn', { hasText: 'on task' }).tap(); await page.waitForTimeout(150);
  return page.evaluate(() => window.__app.S.doc.marks[window.__app.S.doc.marks.length - 1].id);
}
const since = (n) => gisLog.slice(n);

// 1. First link on this device: the one sign-in that is expected.
await page.goto(APP); await page.waitForTimeout(800);
await page.locator('#w-connect').click(); await page.waitForTimeout(1200);
await page.selectOption('#cls', 'B3'); await page.waitForTimeout(200);
await page.locator('.mode.m-pos').click(); await page.waitForTimeout(100);
const linked = await page.evaluate(() => !!window.__app.S.meta.dataId);
check('first link: signed in once and linked to the data file', linked && gisLog.length === 1 && gisLog[0].prompt === '' && (await pill()).includes('Synced'), `${JSON.stringify(gisLog)} / ${await pill()}`);

// Hour-long tokens; the page clock is moved forward (timers are not run).
let clock = Date.now();
const later = async (min) => { clock += min * 60000; await page.clock.setSystemTime(clock); };

// 2. 55 minutes on, within the token's last ten minutes: a tap renews it before it runs out.
await later(55);
let n0 = gisLog.length;
const m0 = await tapMark(5);
await page.waitForTimeout(5000);
const q0 = since(n0);
check("in the token's last ten minutes a tap renews it quietly, before it runs out", q0.length === 1 && q0[0].prompt === 'none' && q0[0].active === true && q0[0].hint === ACCOUNT && inFile(m0), `${JSON.stringify(q0)} / in file ${inFile(m0)}`);

// 3. The token runs out with nobody tapping: no window is opened, and the pill says the next tap syncs.
await later(65);
n0 = gisLog.length;
// The app's own timer does this; a timer carries no tap. (A test evaluate counts as a tap in Chrome,
// so the call is made from a page timer after the browser's 5 s tap window has passed.)
await page.evaluate(() => { setTimeout(() => window.__app.sync(false), 6000); });
await page.waitForTimeout(6500);
const pillOut = await pill();
check('token ran out with no tap: no Google window opened; the pill says Tap to sync', since(n0).length === 0 && /^Tap to sync/.test(pillOut), `${JSON.stringify(since(n0))} / "${pillOut}"`);

// Then the next tap renews it quietly; the tap's mark reaches the file with no sign-in screen.
n0 = gisLog.length;
const m1 = await tapMark(0);
await page.waitForTimeout(5000);
const q = since(n0);
check('expired token: the next tap renews it quietly (no chooser, known account as hint)', q.length === 1 && q[0].prompt === 'none' && q[0].active === true && q[0].hint === ACCOUNT, JSON.stringify(q));
check('the mark tapped then is in the file and the pill says Synced, with no sign-in screen', inFile(m1) && (await pill()).includes('Synced') && !q.some((e) => e.prompt === ''), await pill());

// 4. The app is closed and opened again (token lost). Taps made while signed out sync with no screen.
await page.evaluate(() => sessionStorage.setItem('gis', JSON.stringify({ expiresIn: 3600, allowQuiet: true })));
await page.reload(); await page.waitForTimeout(1200);
n0 = gisLog.length;
const m2 = await tapMark(1), m3 = await tapMark(2);
await page.waitForTimeout(5000);
const q2 = since(n0);
check('after a restart: taps made while signed out sync after one quiet renewal', inFile(m2) && inFile(m3) && q2.length === 1 && q2[0].prompt === 'none' && q2[0].hint === ACCOUNT && (await pill()).includes('Synced'), `${JSON.stringify(q2)} / ${await pill()}`);

// 5. Google needs the teacher (quiet renewal refused): one quiet try, then the pill asks; the taps wait
//    on the device and sync after the sign-in in Google's window.
await page.evaluate(() => sessionStorage.setItem('gis', JSON.stringify({ expiresIn: 3600, allowQuiet: false })));
await page.reload(); await page.waitForTimeout(1200);
n0 = gisLog.length;
const m4 = await tapMark(3), m5 = await tapMark(4);
await page.waitForTimeout(5000);
const q3 = since(n0);
const pillAsk = await pill();
check('quiet renewal refused: one quiet try only, then the pill asks for a sign-in', q3.length === 1 && q3[0].prompt === 'none' && /Tap to sign in · 2 waiting/.test(pillAsk), `${JSON.stringify(q3)} / "${pillAsk}"`);
const waitedOnDevice = !inFile(m4) && !inFile(m5);
n0 = gisLog.length;
await page.locator('#sync').tap(); await page.waitForTimeout(1500);
const q4 = since(n0);
check('guard: taps made while signed out wait on the device and sync after the sign-in', waitedOnDevice && inFile(m4) && inFile(m5) && q4.length === 1 && q4[0].prompt === '' && (await pill()).includes('Synced'), `${JSON.stringify(q4)} / ${await pill()}`);
check('no token is stored on the device', await page.evaluate(async () => {
  const meta = JSON.stringify(await new Promise((res) => { const r = indexedDB.open('room-chart'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('meta'); g.onsuccess = () => res(g.result); }; }));
  return !/tok-\d/.test(meta) && !/tok-\d/.test(JSON.stringify(localStorage)) && !/tok-\d/.test(JSON.stringify(sessionStorage));
}));

console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
console.log('drive calls:', drive.length, '· google windows:', gisLog.length);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
