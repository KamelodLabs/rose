import { readFileSync } from 'node:fs';
import { emitJson, gh, parseArgs, parseCliResult } from './lib.mjs';
import {
  checkCounts,
  currentUser,
  ghJson,
  prView,
  reviewReadiness,
  viewerPermission,
} from './pr-lib.mjs';

const usage = `Usage: node docs/scripts/pr-review.mjs [<number|url|branch>]
       [--approve|--request-changes|--comment] [-b|--body <text>] [--body-file <path>]
       [--yes] [--json]

Without an action this is a read-only review summary. Actions dry-run unless --yes.
Self-approval is not allowed; maintainers can comment and review, then use pr:merge --self-reviewed.`;

const ACTIONS = ['approve', 'request-changes', 'comment'];

function fail(message, jsonMode = false, extra = {}) {
  process.stderr.write(`${message}\n`);
  if (jsonMode) emitJson({ ok: false, error: message, ...extra });
  process.exit(1);
}

function commandLine(args) {
  return `gh ${args
    .map((arg) => (/^[\w./:<>=+-]+$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(' ')}`;
}

function latestReviewStates(pr) {
  return (pr.latestReviews ?? []).map((review) => ({
    author: review.author?.login ?? null,
    state: review.state,
  }));
}

function printChecklist() {
  process.stdout.write('Review checklist:\n');
  process.stdout.write('  - Scope matches the request; no unrelated changes.\n');
  process.stdout.write('  - Tests cover the behavior; pnpm verify passed.\n');
  process.stdout.write('  - Docs updated when behavior or commands changed.\n');
  process.stdout.write('  - Modularity: features/shared boundaries; no app package.json.\n');
  process.stdout.write('  - No secrets, .env files, or generated files.\n');
  process.stdout.write('  - UI changes verified in the app when applicable.\n');
  process.stdout.write('  - Product and technical quality: naming, errors, edge cases.\n');
}

function printSummary(pr, user, readiness, checks) {
  const files = pr.files ?? [];
  process.stdout.write(`PR #${pr.number}: ${pr.title}\n`);
  process.stdout.write(`${pr.url}\n`);
  process.stdout.write(`author: ${pr.author?.login ?? '-'}\n`);
  process.stdout.write(`branch: ${pr.baseRefName} <- ${pr.headRefName}\n`);
  process.stdout.write(`state:  ${pr.state}${pr.isDraft ? ' (draft)' : ''}\n`);
  process.stdout.write(
    `diff:   +${pr.additions ?? 0} -${pr.deletions ?? 0} across ${pr.changedFiles ?? files.length} file(s)\n`,
  );
  process.stdout.write(`commits: ${(pr.commits ?? []).length}\n`);
  process.stdout.write(
    `checks: ${checks.total} total, ${checks.passing} passing, ${checks.failing} failing, ${checks.pending} pending\n`,
  );
  process.stdout.write(
    `review: ${pr.reviewDecision || 'none'}; approvals ${readiness.approvals}\n`,
  );
  const states = latestReviewStates(pr);
  if (states.length > 0) {
    process.stdout.write(
      `latest: ${states.map((entry) => `${entry.author ?? '-'}:${entry.state}`).join(', ')}\n`,
    );
  }
  if (files.length > 0) {
    process.stdout.write(`files (${files.length}):\n`);
    for (const file of files.slice(0, 20)) process.stdout.write(`  ${file.path}\n`);
    if (files.length > 20) process.stdout.write(`  ... ${files.length - 20} more\n`);
  }
  process.stdout.write(
    `review gate: ${readiness.ok ? 'ready' : `not ready (${readiness.code}: ${readiness.reason})`}\n`,
  );
  process.stdout.write(`viewer: ${user}\n`);
  printChecklist();
}

function runAction(pr, action, body, yes, jsonMode, user) {
  if (pr.state !== 'OPEN') {
    fail(`PR #${pr.number} is ${pr.state}; reviews are closed.`, jsonMode, {
      pr: { number: pr.number, state: pr.state, url: pr.url },
    });
  }
  if (action === 'approve' && pr.author?.login === user) {
    fail(
      `refusing to self-approve PR #${pr.number}: GitHub self-approval is not a valid review.\n` +
        `Use --comment for a self-review, then pnpm pr:merge ${pr.number} --yes --self-reviewed.`,
      jsonMode,
      { pr: { number: pr.number, url: pr.url } },
    );
  }
  const args = ['pr', 'review', String(pr.number), `--${action}`];
  if (body) args.push('--body', body);
  const command = commandLine(args);

  if (!yes) {
    const result = {
      ok: true,
      dryRun: true,
      action,
      pr: { number: pr.number, title: pr.title, url: pr.url, author: pr.author?.login ?? null },
      command,
    };
    if (jsonMode) emitJson(result);
    else {
      process.stdout.write(`${command}\n`);
      process.stdout.write('Run with --yes to submit the review.\n');
    }
    return 0;
  }

  const review = gh(args);
  if (!review.ok) {
    fail(`gh pr review failed: ${review.stderr || review.stdout}`, jsonMode, {
      pr: { number: pr.number, url: pr.url },
    });
  }
  let updated = null;
  try {
    updated = ghJson(['pr', 'view', String(pr.number), '--json', 'reviewDecision,latestReviews']);
  } catch {
    updated = null;
  }
  const result = {
    ok: true,
    dryRun: false,
    action,
    pr: { number: pr.number, title: pr.title, url: pr.url, author: pr.author?.login ?? null },
    reviewDecision: updated?.reviewDecision ?? null,
    latestReviews: updated ? latestReviewStates(updated) : null,
  };
  if (jsonMode) emitJson(result);
  else process.stdout.write(`${action.replace('-', ' ')} submitted on PR #${pr.number}.\n`);
  return 0;
}

function parseReview(argv) {
  const mapped = argv.flatMap((arg) => (arg === '-b' ? ['--body'] : [arg]));
  return parseArgs(mapped, {
    flags: ['help', 'yes', 'json', ...ACTIONS],
    values: ['body', 'body-file'],
  });
}

function main() {
  const { parsed, code } = parseCliResult(usage, parseReview);
  if (code !== null) return code;
  if (parsed.positionals.length > 1) {
    process.stderr.write(`unexpected argument: ${parsed.positionals[1]}\n\n${usage}\n`);
    return 1;
  }

  const jsonMode = Boolean(parsed.flags.json);
  const selected = ACTIONS.filter((action) => parsed.flags[action]);
  if (selected.length > 1) {
    fail(`choose only one action: ${selected.join(', ')}`, jsonMode);
  }
  const action = selected[0] ?? null;
  const selector = parsed.positionals[0] ?? null;

  if (parsed.values.body !== undefined && parsed.values['body-file'] !== undefined) {
    fail('use --body or --body-file, not both', jsonMode);
  }
  let body = parsed.values.body ?? '';
  if (parsed.values['body-file']) {
    try {
      body = readFileSync(parsed.values['body-file'], 'utf8');
    } catch (error) {
      fail(`could not read ${parsed.values['body-file']}: ${error.message}`, jsonMode);
    }
  }
  body = body.trim();

  if (action === 'request-changes' && !body) {
    fail('--request-changes needs a body explaining what must change', jsonMode);
  }

  let pr;
  try {
    pr = prView(selector);
  } catch (error) {
    fail(error.message, jsonMode);
  }

  if (action) {
    let user;
    try {
      user = currentUser();
    } catch (error) {
      fail(error.message, jsonMode);
    }
    return runAction(pr, action, body, Boolean(parsed.flags.yes), jsonMode, user);
  }

  let user;
  let permission;
  try {
    user = currentUser();
    permission = viewerPermission();
  } catch (error) {
    fail(error.message, jsonMode);
  }
  const readiness = reviewReadiness(pr, { currentUser: user, permission, selfReviewed: false });
  const checks = checkCounts(pr.statusCheckRollup);
  if (jsonMode) {
    emitJson({
      ok: true,
      pr: {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        author: pr.author?.login ?? null,
        base: pr.baseRefName,
        head: pr.headRefName,
        state: pr.state,
        isDraft: pr.isDraft,
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
        changedFiles: pr.changedFiles ?? (pr.files ?? []).length,
        files: (pr.files ?? []).slice(0, 50).map((file) => file.path),
        filesTruncated: (pr.files ?? []).length > 50,
        commits: (pr.commits ?? []).length,
      },
      checks,
      reviewDecision: pr.reviewDecision ?? '',
      latestReviews: latestReviewStates(pr),
      readiness,
    });
  } else {
    printSummary(pr, user, readiness, checks);
  }
  return 0;
}

process.exitCode = main();
