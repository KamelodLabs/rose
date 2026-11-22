import { spawnSync } from 'node:child_process';
import { firstLine, gh, root } from './lib.mjs';

export const PR_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'author',
  'baseRefName',
  'headRefName',
  'isDraft',
  'reviewDecision',
  'latestReviews',
  'mergeable',
  'mergeStateStatus',
  'files',
  'commits',
  'additions',
  'deletions',
  'changedFiles',
  'statusCheckRollup',
  'body',
].join(',');

const FAILED_CONCLUSIONS = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
]);

export function ghJson(args) {
  const result = gh(args);
  if (!result.ok) {
    const detail = firstLine(result.stderr || result.stdout) || 'unknown gh error';
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${detail}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`gh ${args.slice(0, 3).join(' ')} returned invalid JSON`);
  }
}

export function currentUser() {
  const result = gh(['api', 'user', '--jq', '.login']);
  if (!result.ok) {
    const detail = firstLine(result.stderr || result.stdout) || 'unknown error';
    throw new Error(`could not resolve the current user: ${detail}`);
  }
  const login = result.stdout.trim();
  if (!login) throw new Error('could not resolve the current user: empty login');
  return login;
}

export function viewerPermission() {
  const view = ghJson(['repo', 'view', '--json', 'viewerPermission']);
  return view.viewerPermission ?? null;
}

export function isMaintainer(permission) {
  return permission === 'ADMIN' || permission === 'MAINTAIN';
}

export function prView(selector, fields = PR_FIELDS) {
  const args = ['pr', 'view'];
  if (selector !== undefined && selector !== null && selector !== '') {
    args.push(String(selector));
  }
  args.push('--json', fields);
  return ghJson(args);
}

export function reviewReadiness(pr, { currentUser: user, permission, selfReviewed = false } = {}) {
  const reviews = Array.isArray(pr?.latestReviews) ? pr.latestReviews : [];
  const author = pr?.author?.login ?? null;
  const approvals = reviews.filter(
    (review) =>
      review?.state === 'APPROVED' && review?.author?.login && review.author.login !== author,
  ).length;
  const changesRequested = reviews.some((review) => review?.state === 'CHANGES_REQUESTED');

  const blocked = (code, reason) => ({
    ok: false,
    code,
    reason,
    approvals,
    blocking: [{ code, reason }],
    selfReviewed: false,
  });

  if (pr?.state !== 'OPEN') return blocked('not-open', `PR state is ${pr?.state ?? 'unknown'}`);
  if (pr.isDraft) return blocked('draft', 'PR is a draft');
  if (pr.reviewDecision === 'CHANGES_REQUESTED' || changesRequested) {
    return blocked('changes-requested', 'changes were requested');
  }
  if (pr.reviewDecision === 'APPROVED' || approvals > 0) {
    return {
      ok: true,
      code: 'approved',
      reason: 'a non-author approval is recorded',
      approvals,
      blocking: [],
      selfReviewed: false,
    };
  }
  if (author && user && author === user) {
    if (!isMaintainer(permission)) {
      return blocked(
        'self-merge-forbidden',
        'your PR needs a non-author approval; self-merge requires ADMIN or MAINTAIN',
      );
    }
    if (!selfReviewed) {
      return blocked(
        'review-required',
        'review the PR, then rerun with --self-reviewed (maintainers only)',
      );
    }
    return {
      ok: true,
      code: 'self-reviewed',
      reason: 'maintainer self-review declared',
      approvals,
      blocking: [],
      selfReviewed: true,
    };
  }
  return blocked('review-required', 'a non-author approval is required');
}

export function checkCounts(rollup) {
  const checks = Array.isArray(rollup) ? rollup : [];
  const counts = { total: checks.length, failing: 0, pending: 0, passing: 0 };
  for (const check of checks) {
    const conclusion = check?.conclusion ?? null;
    if (!conclusion) counts.pending += 1;
    else if (FAILED_CONCLUSIONS.has(conclusion)) counts.failing += 1;
    else counts.passing += 1;
  }
  return counts;
}

export function findPr({ head, base, state = 'all', title } = {}) {
  const args = ['pr', 'list', '--state', state, '--limit', '10', '--json', PR_FIELDS];
  if (head) args.push('--head', head);
  if (base) args.push('--base', base);
  const prs = ghJson(args);
  const match = title ? prs.find((pr) => pr.title === title) : prs[0];
  return match ?? null;
}

export function findPromotion(name) {
  const branch = `promote/${name}`;
  return {
    branch,
    staging: findPr({ head: branch, base: 'staging', state: 'all' }),
    main: findPr({
      head: 'staging',
      base: 'main',
      state: 'all',
      title: `chore: promote ${name} to main`,
    }),
  };
}

export function runChecks(selector, { interval, quiet = false } = {}) {
  const args = ['pr', 'checks', String(selector), '--watch', '--fail-fast'];
  if (interval) args.push('--interval', String(interval));
  const result = spawnSync('gh', args, {
    cwd: root,
    stdio: quiet ? ['ignore', 2, 2] : 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`gh pr checks ${selector} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`gh pr checks ${selector} failed with exit ${result.status}`);
  }
}

export function promotionStage(promotion = {}) {
  const staging = promotion.staging ?? null;
  const main = promotion.main ?? null;
  if (staging?.state === 'MERGED' && main?.state === 'MERGED') return 'done';
  if (main?.state === 'OPEN') return 'main-review';
  if (staging?.state === 'MERGED') return 'main-pr-missing';
  if (staging?.state === 'OPEN') return 'staging-review';
  if (staging?.state === 'CLOSED') return 'staging-closed';
  return 'not-started';
}

export function describePr(pr) {
  if (!pr) return null;
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    author: pr.author?.login ?? (typeof pr.author === 'string' ? pr.author : null),
    base: pr.baseRefName ?? pr.base ?? null,
    head: pr.headRefName ?? pr.head ?? null,
    merged: pr.state === 'MERGED',
  };
}
