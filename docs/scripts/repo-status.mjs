import { emitJson, gh, git, isAlive, printTable, readJson } from './lib.mjs';

const jsonMode = process.argv.includes('--json');
const branchResult = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const branch = branchResult.ok ? branchResult.stdout : 'unknown';
const statusResult = git(['status', '--porcelain']);
const dirty = statusResult.ok ? statusResult.stdout.split(/\r?\n/).filter(Boolean) : [];
const upstreamResult = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
let ahead = 0;
let behind = 0;
if (upstreamResult.ok) {
  const count = git(['rev-list', '--left-right', '--count', `${upstreamResult.stdout}...HEAD`]);
  if (count.ok) {
    const [back, front] = count.stdout.split(/\s+/).map(Number);
    behind = Number.isFinite(back) ? back : 0;
    ahead = Number.isFinite(front) ? front : 0;
  }
}
const lastCommit = git(['log', '-1', '--format=%h %s']);
const registry = readJson('.dev/services.json');
const liveServices = Object.entries(registry?.services ?? {})
  .filter(([, service]) => isAlive(service?.pid))
  .map(([name, service]) => ({
    name,
    status: service.status ?? 'unknown',
    port: service.port ?? null,
    url: service.url ?? null,
  }));
const mobile = readJson('mobileRose/.expo/rose-dev.json');

let pr = null;
const ghReady = gh(['auth', 'status']).ok;
if (ghReady) {
  const list = gh([
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number,title,url,statusCheckRollup',
  ]);
  if (list.ok && list.stdout) {
    try {
      pr = JSON.parse(list.stdout)[0] ?? null;
    } catch {
      pr = null;
    }
  }
}

const checks = pr?.statusCheckRollup ?? [];
const failedConclusions = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
]);
const failing = checks.filter((check) => failedConclusions.has(check.conclusion));
const pending = checks.filter((check) => !check.conclusion);

let next = 'Continue with the task.';
if (dirty.length > 0) {
  next = 'Review the working tree: node docs/scripts/review-prep.mjs';
} else if (pr && failing.length > 0) {
  next = `Inspect the failing checks: node docs/scripts/ci-inspect.mjs ${pr.number}`;
} else if (pr && pending.length > 0) {
  next = `Wait for checks on PR #${pr.number}.`;
} else if (pr) {
  next = `PR #${pr.number} is green; merge when ready.`;
} else if (!['dev', 'staging', 'main'].includes(branch)) {
  next = 'Open a PR to dev: node docs/scripts/pr-open.mjs';
} else if (branch === 'dev') {
  next = 'Create a feature branch from dev before changing code.';
} else {
  next = `Use the promotion flow from ${branch}.`;
}

const result = {
  ok: true,
  branch,
  upstream: upstreamResult.ok ? upstreamResult.stdout : null,
  ahead,
  behind,
  dirty,
  lastCommit: lastCommit.ok ? lastCommit.stdout : null,
  services: liveServices,
  mobile: mobile
    ? {
        status: mobile.status ?? 'unknown',
        url: mobile.expoGoUrl ?? null,
        port: mobile.port ?? null,
        qrPath: mobile.qrPath ?? null,
      }
    : null,
  pr: pr
    ? {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        checks: { total: checks.length, failing: failing.length, pending: pending.length },
        failing: failing.map((check) => check.name),
      }
    : null,
  next,
};

if (jsonMode) {
  emitJson(result);
} else {
  process.stdout.write(`branch: ${branch}${result.upstream ? ` (${result.upstream})` : ''}\n`);
  process.stdout.write(`sync:   ahead ${ahead}, behind ${behind}\n`);
  process.stdout.write(`commit: ${result.lastCommit ?? '-'}\n`);
  process.stdout.write(`dirty:  ${dirty.length} path(s)\n`);
  if (dirty.length > 0) {
    for (const path of dirty.slice(0, 15)) process.stdout.write(`  ${path}\n`);
    if (dirty.length > 15) process.stdout.write(`  ... ${dirty.length - 15} more\n`);
  }
  if (liveServices.length > 0) {
    process.stdout.write('services:\n');
    printTable([
      ['service', 'status', 'port', 'url'],
      ...liveServices.map((service) => [
        service.name,
        service.status,
        service.port ?? '-',
        service.url ?? '-',
      ]),
    ]);
  } else {
    process.stdout.write('services: none running (pnpm dev:start)\n');
  }
  if (result.mobile) {
    process.stdout.write(`expo:   ${result.mobile.url ?? 'not ready'} (${result.mobile.status})\n`);
  }
  if (result.pr) {
    process.stdout.write(
      `pr:     #${result.pr.number} ${result.pr.title} — checks ${result.pr.checks.total}, ` +
        `${result.pr.checks.failing} failing, ${result.pr.checks.pending} pending\n`,
    );
  } else {
    process.stdout.write('pr:     none for this branch\n');
  }
  process.stdout.write(`next:   ${next}\n`);
}
