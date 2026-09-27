// Google Drive access: sign-in (Google Identity Services, drive.file scope), the Picker, and
// reading/writing the two JSON files. With drive.file the app sees only files it created or that
// were picked with it; the grant belongs to the account, so after one pick every device can find
// the files by name.

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

  async init() {
    await loadScript('https://accounts.google.com/gsi/client');
    if (!this.client) {
      this.client = google.accounts.oauth2.initTokenClient({ client_id: GOOGLE.clientId, scope: SCOPE, callback: () => {} });
    }
  }

  // interactive: called from a tap, so the browser allows the sign-in window.
  async signIn(interactive, hint) {
    await this.init();
    return new Promise((resolve, reject) => {
      this.client.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        this.token = resp.access_token;
        this.expires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        resolve(this.token);
      };
      this.client.error_callback = (err) => reject(new Error(err && err.type || 'sign-in failed'));
      this.client.requestAccessToken({ prompt: interactive ? '' : 'none', hint: hint || undefined });
    });
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
  async signIn() { return this.token; }
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
