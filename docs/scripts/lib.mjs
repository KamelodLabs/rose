import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const scriptsDir = path.join(root, 'docs', 'scripts');
export const isWindows = process.platform === 'win32';

export function run(command, args = [], options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: options.cwd ?? root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: options.timeout ?? 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, status: 0, stdout: stdout.trim(), stderr: '' };
  } catch (error) {
    return {
      ok: false,
      status: typeof error.status === 'number' ? error.status : 1,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? error.message ?? '').trim(),
    };
  }
}

export function runPnpm(args, options = {}) {
  if (!isWindows) return run('pnpm', args, options);
  return run(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', ['pnpm', ...args].join(' ')],
    options,
  );
}

export function git(args, options = {}) {
  return run('git', args, options);
}

export function gh(args, options = {}) {
  return run('gh', args, options);
}

export function readText(relativePath) {
  try {
    return readFileSync(path.join(root, relativePath), 'utf8');
  } catch {
    return null;
  }
}

export function readJson(relativePath) {
  const text = readText(relativePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function writeJson(relativePath, value) {
  writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function exists(relativePath) {
  return existsSync(path.join(root, relativePath));
}

export function parseArgs(argv, { flags = [], values = [] } = {}) {
  const result = { positionals: [], flags: {}, values: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      result.flags.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const separator = body.indexOf('=');
      const key = separator >= 0 ? body.slice(0, separator) : body;
      const inline = separator >= 0 ? body.slice(separator + 1) : undefined;
      if (flags.includes(key)) {
        if (inline !== undefined) throw new Error(`--${key} does not take a value`);
        result.flags[key] = true;
        continue;
      }
      if (values.includes(key)) {
        const value = inline ?? argv[++index];
        if (value === undefined) throw new Error(`--${key} needs a value`);
        result.values[key] = value;
        continue;
      }
      throw new Error(`unknown flag: --${key}`);
    }
    if (arg.startsWith('-')) throw new Error(`unknown flag: ${arg}`);
    result.positionals.push(arg);
  }
  return result;
}

export function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printTable(rows) {
  if (rows.length === 0) return;
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => String(row[column] ?? '').length)),
  );
  for (const row of rows) {
    process.stdout.write(
      `${row
        .map((cell, column) => String(cell ?? '').padEnd(widths[column]))
        .join('  ')
        .trimEnd()}\n`,
    );
  }
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function resolveBase(base = 'origin/dev') {
  const candidates = [base, `origin/${base}`, 'dev', 'origin/dev'];
  for (const candidate of candidates) {
    if (git(['rev-parse', '--verify', candidate]).ok) return candidate;
  }
  return 'HEAD';
}

export function changedFiles(base = 'origin/dev') {
  const reference = resolveBase(base);
  const files = new Set();
  for (const args of [
    ['diff', '--name-only', reference],
    ['diff', '--name-only', `${reference}...HEAD`],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    const result = git(args);
    if (!result.ok) continue;
    for (const file of result.stdout.split(/\r?\n/).filter(Boolean)) files.add(file);
  }
  return [...files].sort();
}

export function packageForFile(file) {
  if (file.startsWith('apiRose/')) return '@rose/apiRose';
  if (file.startsWith('webRose/')) return '@rose/webRose';
  if (file.startsWith('mobileRose/')) return '@rose/mobileRose';
  return null;
}

export function isRootConfig(file) {
  return (
    [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'turbo.json',
      'tsconfig.base.json',
    ].includes(file) || file.startsWith('.github/')
  );
}

export function isTestFile(file) {
  return (
    /(^|\/)(__tests__)\//.test(file) ||
    /\.(test|spec)\.[jt]sx?$/.test(file) ||
    /_test\.go$/.test(file)
  );
}

export function isMarkdown(file) {
  return /\.mdx?$/i.test(file);
}

export function markdownPlacementIssue(file) {
  const normalized = file.replace(/\\/g, '/');
  if (!isMarkdown(normalized)) return null;
  if (/(^|\/)CLAUDE\.md$/i.test(normalized)) {
    return 'CLAUDE.md is not allowed; use the root AGENTS.md';
  }
  if (/(^|\/)AGENTS\.md$/i.test(normalized) && normalized !== 'AGENTS.md') {
    return 'AGENTS.md is only allowed at the repository root';
  }
  if (normalized === 'AGENTS.md') return null;
  if (/(^|\/)README\.md$/i.test(normalized)) return null;
  if (normalized.startsWith('docs/')) return null;
  if (normalized.startsWith('.github/')) return null;
  if (
    ['CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md'].includes(normalized)
  ) {
    return null;
  }
  return 'Markdown must live under docs/ or be a README/AGENTS/root policy file';
}

export function isForbiddenLockfile(file) {
  return ['package-lock.json', 'yarn.lock', 'bun.lockb', 'npm-shrinkwrap.json'].includes(
    path.basename(file),
  );
}

export function testPlacementIssue(file) {
  const normalized = file.replace(/\\/g, '/');
  if (/(^|\/)__tests__\//.test(normalized) || normalized.startsWith('e2e/')) return null;
  if (/\.(test|spec)\.[jt]sx?$/i.test(normalized)) {
    return 'JS/TS tests must live under __tests__/ (or e2e/)';
  }
  if (/_test\.go$/.test(normalized) && !normalized.startsWith('apiRose/')) {
    return 'Go tests must live under apiRose/';
  }
  return null;
}

export function fileSize(relativePath) {
  try {
    return statSync(path.join(root, relativePath)).size;
  } catch {
    return 0;
  }
}

export function openPath(relativePath) {
  const absolute = path.join(root, relativePath);
  const command = isWindows
    ? process.env.ComSpec || 'cmd.exe'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  const args = isWindows ? ['/d', '/s', '/c', 'start', '', `"${absolute}"`] : [absolute];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
  });
  child.unref();
}

export function nowIso() {
  return new Date().toISOString();
}

export function firstLine(value) {
  return String(value ?? '')
    .trim()
    .split(/\r?\n/)[0];
}
