import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAlive, portIsFree } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const jsonMode = process.argv.includes('--json');
const helpMode = process.argv.includes('--help') || process.argv.includes('-h');
const checks = [];

const usage = `Usage: node docs/scripts/doctor.mjs [--json]

Diagnose the local toolchain, ports, and repo state.
Exit code 1 only for a Node or pnpm version problem; everything else is a warning.`;

function add(name, status, detail) {
  checks.push({ name, status, detail });
}

function readText(relativePath) {
  try {
    return readFileSync(path.join(root, relativePath), 'utf8');
  } catch {
    return null;
  }
}

function readJson(relativePath) {
  const text = readText(relativePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function firstLine(value) {
  return String(value ?? '')
    .trim()
    .split(/\r?\n/)[0];
}

function run(command, args) {
  try {
    const output = execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 20000,
    });
    return { ok: true, stdout: output.trim(), stderr: '' };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? '').trim(),
      stderr: firstLine(error.stderr) || error.code || error.message,
    };
  }
}

function runPnpm(args) {
  if (process.platform !== 'win32') return run('pnpm', args);
  return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', ['pnpm', ...args].join(' ')]);
}

function checkNode() {
  const actual = process.versions.node;
  const expectedRaw = readText('.node-version');
  if (expectedRaw === null) {
    add('node', 'warn', `${actual} (no .node-version file)`);
    return;
  }
  const expected = Number.parseInt(expectedRaw.trim().split('.')[0], 10);
  const actualMajor = Number.parseInt(actual.split('.')[0], 10);
  if (!Number.isInteger(expected)) {
    add('node', 'warn', `${actual} (.node-version is not a version)`);
    return;
  }
  add('node', actualMajor === expected ? 'ok' : 'fail', `${actual} (expected major ${expected})`);
}

function checkPnpm() {
  const manifest = readJson('package.json');
  const packageManager =
    typeof manifest?.packageManager === 'string' ? manifest.packageManager : '';
  const expected = packageManager.startsWith('pnpm@') ? packageManager.slice('pnpm@'.length) : null;
  const result = runPnpm(['--version']);
  if (!result.ok) {
    add('pnpm', 'fail', `not available (${result.stderr || 'pnpm --version failed'})`);
    return;
  }
  const actual = firstLine(result.stdout);
  if (!expected) {
    add('pnpm', 'warn', `${actual} (packageManager does not pin pnpm)`);
    return;
  }
  add('pnpm', actual === expected ? 'ok' : 'fail', `${actual} (expected ${expected})`);
}

function checkTool(name, command, args, parse) {
  const result = run(command, args);
  if (!result.ok) {
    add(name, 'warn', `not available (${result.stderr || 'command failed'})`);
    return;
  }
  add(name, 'ok', parse ? parse(result.stdout) : firstLine(result.stdout));
}

function checkGh() {
  const result = run('gh', ['auth', 'status']);
  if (!result.ok) {
    add('gh', 'warn', result.stderr === 'ENOENT' ? 'not installed' : 'not authenticated');
    return;
  }
  add('gh', 'ok', 'authenticated');
}

async function checkPorts() {
  for (const port of [3000, 8080, 8081]) {
    const free = await portIsFree(port);
    add(`port:${port}`, free ? 'ok' : 'warn', free ? 'free' : 'in use');
  }
}

function checkDevRegistry() {
  if (!existsSync(path.join(root, '.dev', 'services.json'))) {
    add('dev:registry', 'warn', 'no .dev/services.json (run pnpm dev:start)');
    return;
  }
  const registry = readJson('.dev/services.json');
  if (!registry || typeof registry !== 'object' || !registry.services) {
    add('dev:registry', 'warn', '.dev/services.json is not valid');
    return;
  }
  const services = Object.entries(registry.services);
  const live = services.filter(([, service]) => isAlive(service?.pid));
  if (live.length === 0) {
    add('dev:registry', 'warn', `${services.length} registered, none live`);
    return;
  }
  add('dev:registry', 'ok', `${live.length} live of ${services.length} registered`);
}

function checkExpoMetadata() {
  const relativePath = 'mobileRose/.expo/rose-dev.json';
  if (!existsSync(path.join(root, relativePath))) {
    add('expo:metadata', 'warn', `${relativePath} missing`);
    return;
  }
  const metadata = readJson(relativePath);
  if (!metadata) {
    add('expo:metadata', 'warn', `${relativePath} is not valid JSON`);
    return;
  }
  const detailParts = [metadata.status ?? 'unknown'];
  if (metadata.port != null) detailParts.push(`port ${metadata.port}`);
  if (metadata.expoGoUrl) detailParts.push(metadata.expoGoUrl);
  if (metadata.status === 'ready' && !isAlive(metadata.pid)) {
    add('expo:metadata', 'warn', `stale, pid ${metadata.pid ?? 'unknown'} is not running`);
    return;
  }
  add('expo:metadata', metadata.status === 'ready' ? 'ok' : 'warn', detailParts.join(', '));
}

function checkGit() {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch.ok) {
    add('git', 'warn', 'not a git repository');
    return;
  }
  const status = run('git', ['status', '--porcelain']);
  if (!status.ok) {
    add('git', 'warn', `${firstLine(branch.stdout)} (git status failed)`);
    return;
  }
  const changed = status.stdout.split(/\r?\n/).filter(Boolean).length;
  add(
    'git',
    changed === 0 ? 'ok' : 'warn',
    changed === 0
      ? `${firstLine(branch.stdout)}, clean`
      : `${firstLine(branch.stdout)}, ${changed} changed path(s)`,
  );
}

function summary() {
  return checks.reduce(
    (totals, check) => {
      totals[check.status] += 1;
      return totals;
    },
    { ok: 0, warn: 0, fail: 0 },
  );
}

function printHuman() {
  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    process.stdout.write(
      `${check.status.padEnd(4)}  ${check.name.padEnd(width)}  ${check.detail}\n`,
    );
  }
  const totals = summary();
  process.stdout.write(`\n${totals.ok} ok, ${totals.warn} warn, ${totals.fail} fail\n`);
}

async function main() {
  if (helpMode) {
    const stream = jsonMode ? process.stderr : process.stdout;
    stream.write(`${usage}\n`);
    return 0;
  }

  checkNode();
  checkPnpm();
  checkTool('go', 'go', ['version'], firstLine);
  checkGh();
  checkTool('adb', 'adb', ['version'], firstLine);
  checkTool('docker', 'docker', ['--version'], firstLine);
  await checkPorts();
  checkDevRegistry();
  checkExpoMetadata();
  checkGit();

  const totals = summary();
  const exitCode = checks.some(
    (check) => (check.name === 'node' || check.name === 'pnpm') && check.status === 'fail',
  )
    ? 1
    : 0;

  if (jsonMode) {
    const payload = {
      ok: exitCode === 0,
      checkedAt: new Date().toISOString(),
      summary: totals,
      checks,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printHuman();
  }
  return exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  },
);
