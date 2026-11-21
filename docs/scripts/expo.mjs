import { emitJson, isAlive, openPath, parseArgs, readJson } from './lib.mjs';

const usage = `Usage: node docs/scripts/expo.mjs <url|qr> [--open] [--json]`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2), { flags: ['help', 'open', 'json'] });
} catch (error) {
  fail(`${error.message}\n\n${usage}`);
}
if (parsed.flags.help) {
  process.stdout.write(`${usage}\n`);
  process.exit();
}

const command = parsed.positionals[0];
if (!['url', 'qr'].includes(command)) fail(usage);

const metadata = readJson('mobileRose/.expo/rose-dev.json');
if (!metadata) fail('mobileRose/.expo/rose-dev.json is missing; run pnpm dev:start or start');

const payload = {
  ok: true,
  command,
  status: metadata.status ?? 'unknown',
  host: metadata.host ?? null,
  port: metadata.port ?? null,
  expoGoUrl: metadata.expoGoUrl ?? null,
  qrPath: metadata.qrPath ?? null,
  pid: metadata.pid ?? null,
  alive: isAlive(metadata.pid),
};

if (command === 'qr' && parsed.flags.open && metadata.qrPath) openPath(metadata.qrPath);

if (parsed.flags.json) {
  emitJson(payload);
} else if (command === 'url') {
  process.stdout.write(`${payload.expoGoUrl ?? 'not ready'}\n`);
  process.stdout.write(
    `status: ${payload.status}${payload.alive ? '' : ' (process not running)'}\n`,
  );
} else {
  process.stdout.write(`${payload.qrPath ?? 'no QR image'}\n`);
}
