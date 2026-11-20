import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.dirname(scriptDir);
const standaloneRoot = path.join(webRoot, '.next', 'standalone', 'webRose');
const server = path.join(standaloneRoot, 'server.js');

if (!existsSync(server)) {
  console.error('Standalone build not found. Run "pnpm --filter @rose/webRose build" first.');
  process.exit(1);
}

cpSync(path.join(webRoot, '.next', 'static'), path.join(standaloneRoot, '.next', 'static'), {
  recursive: true,
});
cpSync(path.join(webRoot, 'public'), path.join(standaloneRoot, 'public'), { recursive: true });

const child = spawn(process.execPath, [server], { stdio: 'inherit', env: process.env });

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
