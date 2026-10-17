import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { startGameServer } from '../scripts/server.mjs';

const HTML = '<!doctype html><title>Gold Miner test fixture</title><main>20 levels</main>';
async function fixture(t) {
  const parent = resolve(tmpdir());
  const root = await mkdtemp(join(parent, 'gold-miner-start-'));
  await writeFile(join(root, 'index.html'), HTML);
  t.after(async () => {
    const local = relative(parent, resolve(root));
    assert.ok(!isAbsolute(local) && !local.startsWith('..') && local.startsWith('gold-miner-start-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function host(t, handler) {
  const server = http.createServer(handler);
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  t.after(() => close(server));
  return { server, port: server.address().port };
}
function close(server) {
  return new Promise(done => {
    if (!server.listening) { done(); return; }
    server.close(done);
    server.closeAllConnections();
  });
}
async function unusedPort(t) {
  const slot = await host(t, (_, res) => res.end());
  await close(slot.server);
  return slot.port;
}
function track(t, game) {
  if (game.server) t.after(() => close(game.server));
  return game;
}

test('starts on a free port, serves the game and exposes a path-free identity', async t => {
  const root = await fixture(t), port = await unusedPort(t);
  const game = track(t, await startGameServer({ root, preferredPort: port, portCount: 1 }));
  assert.equal(game.port, port);
  assert.equal(game.reused, false);
  assert.equal(await (await fetch(game.url)).text(), HTML);
  const health = await (await fetch(game.url + '__gold-miner__')).json();
  assert.equal(health.application, 'gold-miner');
  assert.match(health.project, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(health).includes(root), false);
  assert.equal((await fetch(game.url + 'missing')).status, 404);
});

test('a second launch reuses the existing game without opening another listener', async t => {
  const root = await fixture(t), port = await unusedPort(t);
  const original = track(t, await startGameServer({ root, preferredPort: port, portCount: 1 }));
  const again = await startGameServer({ root, preferredPort: port, portCount: 1 });
  assert.equal(again.reused, true);
  assert.equal(again.server, null);
  assert.equal(again.url, original.url);
  assert.equal(await (await fetch(original.url)).text(), HTML);
});

test('recognizes an already running legacy server by exact HTML equality', async t => {
  const root = await fixture(t);
  const legacy = await host(t, (req, res) => {
    if (req.url === '/') res.writeHead(200, { 'Content-Type': 'text/html' }).end(HTML);
    else res.writeHead(404).end('Not found');
  });
  const game = await startGameServer({ root, preferredPort: legacy.port, portCount: 1 });
  assert.equal(game.reused, true);
  assert.equal(game.port, legacy.port);
  assert.equal(game.server, null);
});

test('skips unrelated occupied ports and reuses a fallback instance on later launches', async t => {
  const root = await fixture(t);
  const other = await host(t, (_, res) => res.end('Another application'));
  const game = track(t, await startGameServer({ root, preferredPort: other.port, portCount: 10 }));
  assert.equal(game.reused, false);
  assert.ok(game.port > other.port);
  assert.equal(await (await fetch(`http://127.0.0.1:${other.port}/`)).text(), 'Another application');
  // Free the original port. A repeat launch must still find the running fallback.
  await close(other.server);
  const again = await startGameServer({ root, preferredPort: other.port, portCount: 10 });
  assert.equal(again.reused, true);
  assert.equal(again.port, game.port);
});

test('does not reuse a recognized server for another project with identical HTML', async t => {
  const root = await fixture(t), otherRoot = await fixture(t), port = await unusedPort(t);
  const original = track(t, await startGameServer({ root: otherRoot, preferredPort: port, portCount: 1 }));
  await assert.rejects(startGameServer({ root, preferredPort: original.port, portCount: 1 }), /No free local port/);
  assert.equal(await (await fetch(original.url)).text(), HTML);
});

test('an unresponsive unrelated listener times out and leaves no active probe sockets', async t => {
  const root = await fixture(t);
  const silent = await host(t, () => {});
  const started = performance.now();
  await assert.rejects(startGameServer({ root, preferredPort: silent.port, portCount: 1, probeTimeout: 50 }), /No free local port/);
  assert.ok(performance.now() - started < 2000);
});

test('rejects invalid preferred ports before attempting any listener', async t => {
  const root = await fixture(t);
  for (const preferredPort of [0, -1, 65536, NaN, 8080.5]) {
    await assert.rejects(startGameServer({ root, preferredPort }), /PORT must be an integer/);
  }
});
