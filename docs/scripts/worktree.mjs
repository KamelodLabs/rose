import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { emitJson, git, parseArgs, printTable, root, runPnpm } from './lib.mjs';

const usage = `Usage: node docs/scripts/worktree.mjs <new|list|remove> [name] [options]

Options:
  --base <branch>  Base branch for new worktrees (default: dev)
  --install        Run pnpm install in a new worktree
  --yes            Execute new/remove (dry-run by default)
  --json           Print only JSON`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2), {
    flags: ['help', 'yes', 'json', 'install'],
    values: ['base'],
  });
} catch (error) {
  fail(`${error.message}\n\n${usage}`);
  process.exit();
}

if (parsed.flags.help) {
  process.stdout.write(`${usage}\n`);
  process.exit();
}

const command = parsed.positionals[0];
const name = parsed.positionals[1];
const base = parsed.values.base ?? 'dev';
const jsonMode = parsed.flags.json;

function worktreeRoot() {
  return path.join(path.dirname(root), 'rose-worktrees');
}

function slug(value) {
  return value.replace(/[\\/]/g, '-');
}

function listWorktrees() {
  const result = git(['worktree', 'list', '--porcelain']);
  if (!result.ok) return [];
  const entries = [];
  let current = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current);
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.bare = true;
    }
  }
  if (current.path) entries.push(current);
  return entries;
}

function findWorktree(value) {
  return listWorktrees().find(
    (entry) => entry.path === value || entry.branch === value || slug(entry.branch ?? '') === value,
  );
}

if (!command || !['new', 'list', 'remove'].includes(command)) {
  fail(usage);
  process.exit();
}

if (command === 'list') {
  const entries = listWorktrees();
  if (jsonMode) emitJson({ ok: true, worktrees: entries });
  else {
    printTable([
      ['branch', 'path', 'head'],
      ...entries.map((entry) => [entry.branch ?? '-', entry.path, entry.head ?? '-']),
    ]);
  }
  process.exit();
}

if (!name) {
  fail(`${command} needs a branch or worktree name`);
  process.exit();
}

if (command === 'new') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) {
    fail('name must match ^[A-Za-z0-9][A-Za-z0-9._/-]*$');
    process.exit();
  }
  if (!git(['rev-parse', '--verify', `origin/${base}`]).ok) {
    fail(`base branch origin/${base} does not exist`);
    process.exit();
  }
  if (git(['rev-parse', '--verify', `refs/heads/${name}`]).ok) {
    fail(`branch ${name} already exists locally`);
    process.exit();
  }
  const target = path.join(worktreeRoot(), slug(name));
  if (existsSync(target)) {
    fail(`worktree path already exists: ${target}`);
    process.exit();
  }
  mkdirSync(worktreeRoot(), { recursive: true });
  const plan = {
    dryRun: !parsed.flags.yes,
    branch: name,
    base: `origin/${base}`,
    path: target,
    install: Boolean(parsed.flags.install),
  };
  if (!parsed.flags.yes) {
    if (jsonMode) emitJson({ ok: true, ...plan });
    else {
      process.stdout.write('Dry run: no worktree will be created.\n');
      process.stdout.write(`git worktree add -b ${name} ${target} origin/${base}\n`);
      if (plan.install) process.stdout.write(`pnpm install (in ${target})\n`);
      process.stdout.write('Run with --yes to create it.\n');
    }
    process.exit();
  }
  const created = git(['worktree', 'add', '-b', name, target, `origin/${base}`]);
  if (!created.ok) {
    fail(`git worktree add failed: ${created.stderr || created.stdout}`);
    process.exit();
  }
  if (parsed.flags.install) {
    const installed = runPnpm(['install'], { cwd: target, timeout: 900_000 });
    if (!installed.ok) fail(`pnpm install failed: ${installed.stderr || installed.stdout}`);
  }
  const result = { ok: true, ...plan, dryRun: false };
  if (jsonMode) emitJson(result);
  else {
    process.stdout.write(`worktree: ${target}\n`);
    process.stdout.write(`cd ${target}\n`);
    if (!parsed.flags.install) process.stdout.write('pnpm install\n');
    process.stdout.write(
      'note: copy .env.local files if needed; each worktree needs its own .codegraph/.\n',
    );
  }
  process.exit();
}

if (command === 'remove') {
  const target = findWorktree(name);
  if (!target) {
    fail(`no worktree found for ${name}`);
    process.exit();
  }
  const status = git(['-C', target.path, 'status', '--porcelain']);
  if (!status.ok) {
    fail(`cannot inspect ${target.path}: ${status.stderr || status.stdout}`);
    process.exit();
  }
  if (status.stdout) {
    fail(`worktree is dirty: ${target.path}`);
    process.exit();
  }
  if (!parsed.flags.yes) {
    if (jsonMode) emitJson({ ok: true, dryRun: true, path: target.path, branch: target.branch });
    else {
      process.stdout.write(`Dry run: would remove ${target.path} (${target.branch ?? '-'}).\n`);
      process.stdout.write('Run with --yes to remove it.\n');
    }
    process.exit();
  }
  const removed = git(['worktree', 'remove', target.path]);
  if (!removed.ok) {
    fail(`git worktree remove failed: ${removed.stderr || removed.stdout}`);
    process.exit();
  }
  const result = { ok: true, dryRun: false, path: target.path, branch: target.branch };
  if (jsonMode) emitJson(result);
  else process.stdout.write(`removed worktree ${target.path}\n`);
}
