// Local test server: serves the app and a stand-in for the two Drive files.
//   node tests/test-server.mjs <port> <folder holding class-tracker-data.json and class-tracker-inbox.json>
// The app is opened as http://localhost:<port>/?testdrive=http://localhost:<port>/api
import http from 'node:http';
import { readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] || 8123);
const dataDir = process.argv[3];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let writes = 0;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname === '/api/find') {
      const name = url.searchParams.get('name');
      const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json') && !f.startsWith('.') && (name === '*' || f === name)).map((f) => ({ id: f, name: f }));
      return send(res, 200, JSON.stringify({ files }), '.json');
    }
    if (url.pathname.startsWith('/api/file/')) {
      const id = decodeURIComponent(url.pathname.slice(10));
      if (!/^[\w.-]+$/.test(id)) return send(res, 400, 'bad id');
      if (req.method === 'PUT') {
        let body = ''; for await (const c of req) body += c;
        JSON.parse(body);
        // Whole-file replace, as Drive does: write aside, then rename over.
        const tmp = join(dataDir, `.${id}.${process.hrtime.bigint()}.tmp`);
        await writeFile(tmp, body); await rename(tmp, join(dataDir, id)); writes++;
        return send(res, 200, '{}', '.json');
      }
      return send(res, 200, await readFile(join(dataDir, id)), '.json');
    }
    if (url.pathname === '/api/stats') return send(res, 200, JSON.stringify({ writes }), '.json');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
    if (!p) p = 'index.html';
    send(res, 200, await readFile(join(root, p)), extname(p));
  } catch (e) { send(res, 404, 'not found'); }
}).listen(port, () => console.log(`test server on ${port}, data in ${dataDir}`));

function send(res, code, body, ext) {
  res.writeHead(code, { 'Content-Type': types[ext] || 'text/plain', 'Cache-Control': 'no-store' });
  res.end(body);
}
