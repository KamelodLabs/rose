import { emitJson, gh, git, isAlive, printTable, readJson } from './lib.mjs';
import {
  checkCounts,
  currentUser,
  isMaintainer,
  reviewReadiness,
  viewerPermission,
} from './pr-lib.mjs';

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
let user = null;
let permission = null;
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
    [
      'number',
      'title',
      'url',
      'state',
      'isDraft',
      'author',
      'baseRefName',
      'headRefName',
      'reviewDecision',
      'latestReviews',
      'mergeable',
      'mergeStateStatus',
      'statusCheckRollup',
    ].join(','),
  ]);
  if (list.ok && list.stdout) {
    try {
      pr = JSON.parse(list.stdout)[0] ?? null;
    } catch {
      pr = null;
    }
  }
  if (pr) {
    try {
      user = currentUser();
    } catch {
      user = null;
    }
    try {
      permission = viewerPermission();
    } catch {
      permission = null;
    }
  }
}

const checks = checkCounts(pr?.statusCheckRollup);
const failingChecks = (pr?.statusCheckRollup ?? []).filter((check) =>
  ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(
    check.conclusion,
  ),
);
const readiness =
  pr && user ? reviewReadiness(pr, { currentUser: user, permission, selfReviewed: false }) : null;
const isAuthor = Boolean(pr && user && pr.author?.login === user);
const maintainer = isMaintainer(permission);

let devAheadOfMain = 0;
if (branch === 'dev' && dirty.length === 0) {
  const count = git(['rev-list', '--count', 'origin/main..dev']);
  devAheadOfMain = count.ok ? Number(count.stdout) || 0 : 0;
}

let next = 'Continue with the task.';
if (dirty.length > 0) {
  next = 'Review the working tree: node docs/scripts/review-prep.mjs';
} else if (pr && checks.failing > 0) {
  next = `Inspect the failing checks: node docs/scripts/ci-inspect.mjs ${pr.number}`;
} else if (pr && (checks.total === 0 || checks.pending > 0)) {
  next = `Watch the checks: pnpm ci:watch ${pr.number}`;
} else if (pr && readiness && !readiness.ok) {
  if (pr.isDraft) {
    next = `Mark PR #${pr.number} ready for review, then pnpm pr:review ${pr.number}`;
  } else if (isAuthor && maintainer) {
    next =
      `Review your PR, then: pnpm pr:review ${pr.number} -- --comment -b "self-review"; ` +
      `pnpm pr:merge ${pr.number} --yes --self-reviewed`;
  } else {
    next = `Review the PR: pnpm pr:review ${pr.number}`;
  }
} else if (pr && readiness?.ok) {
  next = `Merge when ready: pnpm pr:merge ${pr.number} --yes`;
} else if (pr) {
  next = `Review and merge: pnpm pr:review ${pr.number}; pnpm pr:merge ${pr.number}`;
} else if (!['dev', 'staging', 'main'].includes(branch)) {
  next = 'Open a PR to dev: node docs/scripts/pr-open.mjs';
} else if (branch === 'dev') {
  next =
    devAheadOfMain > 0
      ? 'Create a feature branch from dev, or promote dev when it is ready: pnpm promote <name>'
      : 'Create a feature branch from dev before changing code.';
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
        state: pr.state,
        isDraft: Boolean(pr.isDraft),
        author: pr.author?.login ?? null,
        base: pr.baseRefName,
        head: pr.headRefName,
        reviewDecision: pr.reviewDecision ?? '',
        latestReviews: (pr.latestReviews ?? []).map((review) => ({
          author: review.author?.login ?? null,
          state: review.state,
        })),
        mergeable: pr.mergeable,
        mergeStateStatus: pr.mergeStateStatus,
        checks,
        failing: failingChecks.map((check) => check.name),
        review: readiness,
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
      `pr:     #${result.pr.number} ${result.pr.title} — ${result.pr.state}` +
        `${result.pr.isDraft ? ' (draft)' : ''}\n`,
    );
    process.stdout.write(
      `        ${result.pr.base} <- ${result.pr.head}; review ${result.pr.reviewDecision || 'none'}` +
        `${result.pr.review ? `, approvals ${result.pr.review.approvals}` : ''}\n`,
    );
    process.stdout.write(
      `        checks ${result.pr.checks.total}: ${result.pr.checks.passing} passing, ` +
        `${result.pr.checks.failing} failing, ${result.pr.checks.pending} pending\n`,
    );
  } else {
    process.stdout.write('pr:     none for this branch\n');
  }
  process.stdout.write(`next:   ${next}\n`);
}
