import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const registryPath = path.join(root, '.dev', 'services.json');

const targets = [
  '.turbo',
  'webRose/.next',
  'mobileRose/.expo',
  '.cache',
  'apiRose/bin',
  'test-results',
  'coverage',
  'webRose/tsconfig.tsbuildinfo',
];

const usage = `Usage: node docs/scripts/clean.mjs [--yes] [--json]

Remove generated caches: ${targets.join(', ')}.
Without --yes this is a dry run. Refuses while dev services are running (pnpm dev:stop first).`;

class UsageError extends Error {}

function parseArgs(argv) {
  const flags = { yes: false, json: false, help: false };
  for (const arg of argv) {
    if (arg === '--yes') flags.yes = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('-')) throw new UsageError(`unknown flag: ${arg}`);
    else throw new UsageError(`unexpected argument: ${arg}`);
  }
  return flags;
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function liveServices() {
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    return [];
  }
  return Object.entries(registry?.services ?? {})
    .filter(([, service]) => isAlive(service?.pid))
    .map(([name, service]) => ({ name, pid: service.pid }));
}

function directorySize(absolute) {
  let total = 0;
  const stack = [absolute];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        try {
          total += statSync(child).size;
        } catch {
          // A file vanished while measuring; ignore it.
        }
      }
    }
  }
  return total;
}

function describe(target) {
  const absolute = path.join(root, target);
  if (!existsSync(absolute)) return { path: target, exists: false, size: 0 };
  const stats = statSync(absolute, { throwIfNoEntry: false });
  if (!stats) return { path: target, exists: false, size: 0 };
  if (stats.isFile()) return { path: target, exists: true, size: stats.size };
  return { path: target, exists: true, size: directorySize(absolute) };
}

function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function printTable(rows) {
  const width = Math.max(...rows.map((row) => row.path.length));
  for (const row of rows) {
    const label = row.exists ? humanSize(row.size) : 'missing';
    process.stdout.write(`  ${row.path.padEnd(width)}  ${label.padStart(9)}\n`);
  }
}

function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage}\n`);
    return 1;
  }

  if (flags.help) {
    const stream = flags.json ? process.stderr : process.stdout;
    stream.write(`${usage}\n`);
    return 0;
  }

  const running = liveServices();
  const targetRows = targets.map(describe);

  if (running.length > 0) {
    const reason = 'live dev services are running; run pnpm dev:stop first';
    if (flags.json) {
      emitJson({
        dryRun: !flags.yes,
        refused: true,
        reason,
        liveServices: running,
        targets: targetRows,
      });
    } else {
      process.stdout.write(`Refusing to clean: ${reason}.\n`);
      for (const service of running)
        process.stdout.write(`  ${service.name}: pid ${service.pid}\n`);
    }
    return 1;
  }

  if (!flags.yes) {
    if (flags.json) {
      emitJson({
        dryRun: true,
        refused: false,
        targets: targetRows,
        totalBytes: targetRows.reduce((total, row) => total + row.size, 0),
      });
      return 0;
    }
    process.stdout.write('Dry run: no files will be deleted.\n');
    printTable(targetRows);
    const total = targetRows.reduce((sum, row) => sum + row.size, 0);
    process.stdout.write(`Total: ${humanSize(total)}\n`);
    process.stdout.write('Delete these paths with: node docs/scripts/clean.mjs --yes\n');
    return 0;
  }

  const deleted = [];
  const failed = [];
  for (const target of targets) {
    const absolute = path.join(root, target);
    if (!existsSync(absolute)) {
      deleted.push({ path: target, removed: false });
      continue;
    }
    try {
      rmSync(absolute, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      deleted.push({ path: target, removed: true });
    } catch (error) {
      failed.push({ path: target, error: error.message });
    }
  }

  if (flags.json) {
    emitJson({ dryRun: false, refused: false, deleted, failed });
    return failed.length > 0 ? 1 : 0;
  }

  process.stdout.write('Removed generated caches.\n');
  for (const entry of deleted) {
    process.stdout.write(`  ${entry.removed ? 'removed' : 'missing'}  ${entry.path}\n`);
  }
  for (const entry of failed) process.stdout.write(`  failed   ${entry.path}: ${entry.error}\n`);
  return failed.length > 0 ? 1 : 0;
}

process.exitCode = main();
