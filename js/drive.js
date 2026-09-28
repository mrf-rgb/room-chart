// Google Drive access: sign-in (Google Identity Services, drive.file scope), the Picker, and
// reading/writing the two JSON files. With drive.file the app sees only files it created or that
// were picked with it; the grant belongs to the account, so after one pick every device can find
// the files by name.
//
// Access tokens last about an hour and are kept in memory only. A new one can be asked for quietly
// (prompt 'none', the known account as the hint): Google's own window then shows no account
// chooser and closes by itself, or answers that it needs the teacher. Browsers open that window
// only during a tap, so the app asks on a tap.

import { GOOGLE, FILES } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

export class GoogleDrive {
  constructor() {
    this.base = 'https://www.googleapis.com';
    this.token = null;
    this.expires = 0;
    this.client = null;
  }

  configured() { return !!GOOGLE.clientId; }
  hasToken() { return !!this.token && Date.now() < this.expires - 60000; }
  // No token, or one that runs out within ms.
  expiresSoon(ms) { return !this.token || Date.now() > this.expires - ms; }

  async init() {
    await loadScript('https://accounts.google.com/gsi/client');
    if (!this.client) {
      this.client = google.accounts.oauth2.initTokenClient({ client_id: GOOGLE.clientId, scope: SCOPE, callback: () => {} });
    }
  }

  // Called from a tap, so the browser allows Google's window. interactive: Google may show its
  // sign-in or consent screen. Quiet (not interactive): no screen at all; if Google needs the
  // teacher it answers with an error (code 'interaction') instead.
  async signIn(interactive, hint) {
    if (this.pending) return this.pending;
    if (!this.client) await this.init();
    this.pending = new Promise((resolve, reject) => {
      this.client.callback = (resp) => {
        if (resp.error) return reject(Object.assign(new Error(resp.error), { code: 'interaction' }));
        this.token = resp.access_token;
        this.expires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        resolve(this.token);
      };
      this.client.error_callback = (err) => reject(Object.assign(new Error(err && err.type || 'sign-in failed'), { code: 'popup' }));
      this.client.requestAccessToken({ prompt: interactive ? '' : 'none', login_hint: hint || undefined, hint: hint || undefined });
    });
    const stop = setTimeout(() => { this.pending = null; }, 120000); // a window that never answers
    try { return await this.pending; } finally { clearTimeout(stop); this.pending = null; }
  }

  // The signed-in account, used as the hint for quiet renewal.
  async account() {
    const res = await this.fetch('/drive/v3/about?fields=user(emailAddress)');
    return ((await res.json()).user || {}).emailAddress || '';
  }

  async fetch(path, opts = {}) {
    if (!this.hasToken()) throw Object.assign(new Error('signed out'), { code: 'auth' });
    const res = await fetch(this.base + path, {
      ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) { this.token = null; throw Object.assign(new Error('signed out'), { code: 'auth' }); }
    if (res.status === 404 || res.status === 403) throw Object.assign(new Error(`no access (${res.status})`), { code: 'access' });
    if (!res.ok) throw new Error(`Drive ${res.status}`);
    return res;
  }

  // Files this app can see with that exact name.
  async find(name) {
    const q = encodeURIComponent(`name='${name}' and trashed=false`);
    const res = await this.fetch(`/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&spaces=drive`);
    return (await res.json()).files || [];
  }

  async read(id) {
    const res = await this.fetch(`/drive/v3/files/${id}?alt=media`, { cache: 'no-store' });
    return res.json();
  }

  async write(id, obj) {
    await this.fetch(`/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj, null, 1),
    });
  }

  // The Picker, several files at once, so the data file and the inbox can be picked together.
  async pick() {
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((resolve) => gapi.load('picker', resolve));
    return new Promise((resolve) => {
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setQuery('class-tracker').setIncludeFolders(true).setMode(google.picker.DocsViewMode.LIST);
      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(this.token)
        .setDeveloperKey(GOOGLE.apiKey)
        .setAppId(GOOGLE.appId)
        .setTitle(`Pick ${FILES.data} and ${FILES.inbox}`)
        .setCallback((data) => {
          const action = data[google.picker.Response.ACTION];
          if (action === google.picker.Action.PICKED) {
            resolve(data[google.picker.Response.DOCUMENTS].map((d) => ({ id: d[google.picker.Document.ID], name: d[google.picker.Document.NAME] })));
          } else if (action === google.picker.Action.CANCEL) resolve([]);
        })
        .build();
      picker.setVisible(true);
    });
  }
}

// Stand-in for Drive used only by the local test harness (localhost pages only).
export class TestDrive {
  constructor(base) { this.base = base; this.token = 'test'; this.expires = Infinity; }
  configured() { return true; }
  hasToken() { return true; }
  expiresSoon() { return false; }
  async init() {}
  async signIn() { return this.token; }
  async account() { return ''; }
  async find(name) { return (await (await fetch(`${this.base}/find?name=${encodeURIComponent(name)}`)).json()).files; }
  async read(id) {
    const r = await fetch(`${this.base}/file/${id}`, { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error('no access'), { code: 'access' });
    return r.json();
  }
  async write(id, obj) {
    const r = await fetch(`${this.base}/file/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
    if (!r.ok) throw new Error('write failed');
  }
  async pick() { return this.find('*'); }
}

export function makeDrive() {
  const p = new URLSearchParams(location.search);
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && p.get('testdrive')) return new TestDrive(p.get('testdrive'));
  return new GoogleDrive();
}
