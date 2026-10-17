import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { startGameServer } from './server.mjs';

function openBrowser(url) {
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  child.on('error', () => console.log(`Open ${url} in your browser.`));
  child.unref();
}

try {
  const game = await startGameServer({
    root: fileURLToPath(new URL('../dist/', import.meta.url)),
    preferredPort: Number(process.env.PORT || 8080),
  });
  console.log(`\n  GOLD MINER - 20 LEVELS\n  ${game.url}\n`);
  if (game.reused) console.log('  Game is already running. Reusing the existing server.\n');
  else console.log('  Keep this window open while playing. Press Ctrl+C to stop.\n');
  if (process.argv.includes('--open')) openBrowser(game.url);
} catch (error) {
  console.error(`Unable to start the game: ${error.message}`);
  process.exitCode = 1;
}
