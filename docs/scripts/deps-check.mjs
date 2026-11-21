import path from 'node:path';
import { emitJson, parseArgs, root, run, runPnpm } from './lib.mjs';

const usage = `Usage: node docs/scripts/deps-check.mjs [--json]

Read-only: reports outdated pnpm, Expo and Go dependencies. It never updates anything.`;

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2), { flags: ['help', 'json'] });
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage}\n`);
  process.exit(1);
}
if (parsed.flags.help) {
  process.stdout.write(`${usage}\n`);
  process.exit();
}

const pnpm = runPnpm(['outdated', '--format', 'json'], { timeout: 180_000 });
let pnpmOutdated = null;
if (pnpm.stdout) {
  try {
    const parsed = JSON.parse(pnpm.stdout);
    pnpmOutdated = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed).map(([name, info]) => ({
          packageName: name,
          ...(info && typeof info === 'object' ? info : { latest: info }),
        }));
  } catch {
    pnpmOutdated = null;
  }
}
const pnpmOk = pnpmOutdated !== null;

const expo = runPnpm(['--filter', '@rose/mobileRose', 'exec', 'expo', 'install', '--check'], {
  timeout: 180_000,
});

const go = run('go', ['list', '-m', '-u', 'all'], {
  cwd: path.join(root, 'apiRose'),
  timeout: 180_000,
});
const goUpdates = go.ok
  ? go.stdout
      .split(/\r?\n/)
      .filter((line) => line.includes('[') && line.includes(']'))
      .map((line) => line.trim())
  : [];

const result = {
  ok: true,
  pnpm: {
    ok: pnpmOk,
    outdated: pnpmOutdated,
    outdatedCount: pnpmOutdated?.length ?? null,
    error: pnpmOk ? null : pnpm.stderr || pnpm.stdout,
  },
  expo: {
    ok: expo.ok,
    output: [expo.stdout, expo.stderr].filter(Boolean).join('\n').trim(),
  },
  go: {
    ok: go.ok,
    updates: goUpdates,
    error: go.ok ? null : go.stderr || go.stdout,
  },
};

if (parsed.flags.json) {
  emitJson(result);
} else {
  process.stdout.write('pnpm:\n');
  if (pnpmOutdated === null) {
    process.stdout.write(`  ${result.pnpm.error ?? 'unavailable'}\n`);
  } else if (pnpmOutdated.length === 0) {
    process.stdout.write('  up to date\n');
  } else {
    for (const entry of pnpmOutdated) {
      process.stdout.write(
        `  ${entry.packageName ?? entry.name ?? '?'}: ${entry.current ?? '?'} -> ${entry.latest ?? '?'}\n`,
      );
    }
  }
  process.stdout.write('expo:\n');
  if (result.expo.ok) process.stdout.write('  compatible\n');
  else process.stdout.write(`${result.expo.output.replace(/^/gm, '  ')}\n`);
  process.stdout.write('go:\n');
  if (goUpdates.length === 0) process.stdout.write('  up to date\n');
  else for (const update of goUpdates) process.stdout.write(`  ${update}\n`);
}
