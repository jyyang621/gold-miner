import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, extname } from 'node:path';

const HOST = '127.0.0.1';
const HEALTH_PATH = '/__gold-miner__';
const MAX_PROBE_BYTES = 256 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};

function identity(root) {
  const path = resolve(root);
  return createHash('sha256').update(process.platform === 'win32' ? path.toLowerCase() : path).digest('hex');
}

/** Probe only loopback, with an absolute deadline and a bounded response body. */
function request(port, path, timeout) {
  return new Promise(resolveRequest => {
    let settled = false;
    let deadline;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolveRequest(result);
    };
    const req = http.get({ hostname: HOST, port, path, agent: false }, res => {
      let size = 0;
      const chunks = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_PROBE_BYTES) { finish(null); req.destroy(); return; }
        chunks.push(chunk);
      });
      res.on('end', () => finish({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', () => finish(null));
    });
    req.on('error', () => finish(null));
    deadline = setTimeout(() => { finish(null); req.destroy(); }, timeout);
  });
}

async function isThisGame(port, project, html, timeout) {
  const health = await request(port, HEALTH_PATH, timeout);
  if (health?.status === 200) {
    try {
      const info = JSON.parse(health.body.toString('utf8'));
      if (info.application === 'gold-miner' && info.version === 1) return info.project === project;
    } catch { /* An unrelated service can return HTML at every URL. */ }
  }
  // Compatibility with a game server started before the identity endpoint existed.
  // Exact file equality avoids mistaking an unrelated app or generic title for this game.
  const index = await request(port, '/', timeout);
  return index?.status === 200 && index.body.equals(html);
}

function createGameServer(root, project) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path === HEALTH_PATH) {
        const body = JSON.stringify({ application: 'gold-miner', version: 1, project });
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      const local = relative(root, file);
      if (local.startsWith('..') || isAbsolute(local)) { res.writeHead(403).end('Forbidden'); return; }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(404).end('Not found'); }
  });
}

function listen(server, port) {
  return new Promise((resolveListen, reject) => {
    const failed = error => { server.removeListener('listening', ready); reject(error); };
    const ready = () => { server.removeListener('error', failed); resolveListen(); };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, HOST);
  });
}

/** Reuse this project's server, or bind a free port without stopping other programs. */
export async function startGameServer({ root, preferredPort = 8080, portCount = 20, probeTimeout = 350 }) {
  if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  if (!Number.isInteger(portCount) || portCount < 1 || portCount > 100) throw new Error('Invalid port search range.');
  root = resolve(root);
  let html;
  try { html = await readFile(resolve(root, 'index.html')); }
  catch { throw new Error('Game files are missing. Please run pnpm build first.'); }
  const project = identity(root);
  const ports = Array.from({ length: Math.min(portCount, 65536 - preferredPort) }, (_, i) => preferredPort + i);

  // Scan before binding, so an instance on a fallback port is also reused next time.
  for (const port of ports) {
    if (await isThisGame(port, project, html, probeTimeout)) return { reused: true, port, url: `http://${HOST}:${port}/`, server: null };
  }
  for (const port of ports) {
    const server = createGameServer(root, project);
    try {
      await listen(server, port);
      return { reused: false, port, url: `http://${HOST}:${port}/`, server };
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      // Another launcher might have won the race after the scan.
      if (await isThisGame(port, project, html, probeTimeout)) return { reused: true, port, url: `http://${HOST}:${port}/`, server: null };
    }
  }
  throw new Error(`No free local port between ${ports[0]} and ${ports.at(-1)}. Try setting PORT to another number.`);
}
