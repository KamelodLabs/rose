import { emitJson, git, parseArgs } from './lib.mjs';

const usage = `Usage: node docs/scripts/sync.mjs [--prune] [--yes] [--json]

Fetches origin, fast-forwards dev/staging/main when they have no local commits, and optionally
deletes local branches fully merged into origin/dev. Dry-run unless --yes.`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2), { flags: ['help', 'prune', 'yes', 'json'] });
} catch (error) {
  fail(`${error.message}\n\n${usage}`);
}
if (parsed.flags.help) {
  process.stdout.write(`${usage}\n`);
  process.exit();
}

const fetched = git(['fetch', 'origin', '--prune']);
if (!fetched.ok) fail(`git fetch failed: ${fetched.stderr || fetched.stdout}`);

const branchResult = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const current = branchResult.ok ? branchResult.stdout : '';
const longLived = ['dev', 'staging', 'main'];
const plan = [];
for (const branch of longLived) {
  if (!git(['rev-parse', '--verify', `refs/heads/${branch}`]).ok) {
    plan.push({ branch, status: 'missing' });
    continue;
  }
  if (!git(['rev-parse', '--verify', `origin/${branch}`]).ok) {
    plan.push({ branch, status: 'no-upstream' });
    continue;
  }
  const behindResult = git(['rev-list', '--count', `${branch}..origin/${branch}`]);
  const aheadResult = git(['rev-list', '--count', `origin/${branch}..${branch}`]);
  const behind = Number(behindResult.stdout) || 0;
  const ahead = Number(aheadResult.stdout) || 0;
  const action = ahead > 0 ? 'diverged' : behind > 0 ? 'fast-forward' : 'up-to-date';
  plan.push({ branch, ahead, behind, current: branch === current, action });
}

const prune = [];
if (parsed.flags.prune) {
  const merged = git(['branch', '--merged', 'origin/dev', '--format=%(refname:short)']);
  if (merged.ok) {
    for (const branch of merged.stdout.split(/\r?\n/).filter(Boolean)) {
      if (longLived.includes(branch) || branch === current) continue;
      prune.push(branch);
    }
  }
}

const result = { ok: true, dryRun: !parsed.flags.yes, current, branches: plan, prune };
if (!parsed.flags.yes) {
  if (parsed.flags.json) emitJson(result);
  else {
    process.stdout.write('Dry run: no local branches will move.\n');
    for (const entry of plan) {
      process.stdout.write(
        `  ${entry.branch.padEnd(8)} ${entry.action}${entry.ahead ? ` ahead ${entry.ahead}` : ''}` +
          `${entry.behind ? ` behind ${entry.behind}` : ''}\n`,
      );
    }
    if (prune.length) process.stdout.write(`would delete merged branches: ${prune.join(', ')}\n`);
    process.stdout.write('Run with --yes to apply.\n');
  }
  process.exit();
}

const applied = [];
for (const entry of plan) {
  if (entry.action !== 'fast-forward') continue;
  const update = entry.current
    ? git(['merge', '--ff-only', `origin/${entry.branch}`])
    : git(['branch', '-f', entry.branch, `origin/${entry.branch}`]);
  applied.push({
    branch: entry.branch,
    updated: update.ok,
    error: update.ok ? null : update.stderr || update.stdout,
  });
}
const deleted = [];
for (const branch of prune) {
  const removal = git(['branch', '-d', branch]);
  deleted.push({ branch, deleted: removal.ok, error: removal.ok ? null : removal.stderr });
}

result.dryRun = false;
result.applied = applied;
result.deleted = deleted;
if (parsed.flags.json) emitJson(result);
else {
  for (const entry of applied) {
    process.stdout.write(
      `  ${entry.updated ? 'updated' : 'failed '} ${entry.branch}${entry.error ? `: ${entry.error}` : ''}\n`,
    );
  }
  for (const entry of deleted) {
    process.stdout.write(
      `  ${entry.deleted ? 'deleted' : 'failed '} ${entry.branch}${entry.error ? `: ${entry.error}` : ''}\n`,
    );
  }
}
