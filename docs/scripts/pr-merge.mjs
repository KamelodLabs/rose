import { emitJson, gh, parseArgs, parseCliResult, sleepSync } from './lib.mjs';
import {
  checkCounts,
  currentUser,
  describePr,
  isMaintainer,
  prView,
  reviewReadiness,
  runChecks,
  viewerPermission,
} from './pr-lib.mjs';

const usage = `Usage: node docs/scripts/pr-merge.mjs [<number|url|branch>]
       [--squash|--merge|--rebase] [--delete-branch] [--self-reviewed] [--yes] [--json]

Dry run unless --yes. Every PR needs review: a non-author approval, or --self-reviewed for
maintainers after they review their own PR. No --auto and no --admin.`;

const STRATEGIES = ['squash', 'merge', 'rebase'];

function fail(message, jsonMode, extra = {}) {
  process.stderr.write(`${message}\n`);
  if (jsonMode) emitJson({ ok: false, error: message, ...extra });
  process.exit(1);
}

function explicitStrategy(flags) {
  const selected = STRATEGIES.filter((strategy) => flags[strategy]);
  if (selected.length > 1) {
    throw new Error(
      `choose only one strategy: ${selected.map((value) => `--${value}`).join(', ')}`,
    );
  }
  return selected[0] ?? null;
}

function strategyFor(pr, flags) {
  const explicit = explicitStrategy(flags);
  if (explicit) return explicit;
  const promotion =
    pr.headRefName?.startsWith('promote/') ||
    pr.baseRefName === 'staging' ||
    pr.baseRefName === 'main';
  return promotion ? 'merge' : 'squash';
}

function blockersFor(pr, readiness, checks) {
  const blockers = [];
  if (pr.state !== 'OPEN') blockers.push(`PR state is ${pr.state}`);
  if (pr.isDraft) blockers.push('PR is a draft');
  if (pr.mergeable !== 'MERGEABLE') blockers.push(`mergeable is ${pr.mergeable ?? 'unknown'}`);
  if (pr.mergeStateStatus === 'DIRTY' || pr.mergeStateStatus === 'BLOCKED') {
    blockers.push(`merge state is ${pr.mergeStateStatus}`);
  }
  if (!readiness.ok) blockers.push(`review gate: ${readiness.reason}`);
  if (checks.failing > 0) blockers.push(`${checks.failing} failing check(s)`);
  return blockers;
}

function nextStep(pr, readiness, blockers) {
  if (pr.state !== 'OPEN') {
    return pr.state === 'MERGED' ? 'Already merged.' : 'This PR is closed; nothing to merge.';
  }
  if (pr.isDraft) {
    return `Mark PR #${pr.number} ready for review, then rerun this command.`;
  }
  if (!readiness.ok) return `pnpm pr:review ${pr.number}`;
  if (blockers.length > 0) return 'Resolve the blockers, then rerun this command.';
  return `Run with --yes to merge PR #${pr.number}.`;
}

function printSummary(pr, strategy, readiness, checks, blockers, next, deleteBranch) {
  process.stdout.write(`PR #${pr.number}: ${pr.title}\n`);
  process.stdout.write(`${pr.url}\n`);
  process.stdout.write(`branch:   ${pr.baseRefName} <- ${pr.headRefName}\n`);
  process.stdout.write(`author:   ${pr.author?.login ?? '-'}\n`);
  process.stdout.write(`state:    ${pr.state}${pr.isDraft ? ' (draft)' : ''}\n`);
  process.stdout.write(`strategy: ${strategy}${deleteBranch ? ' + delete branch' : ''}\n`);
  process.stdout.write(
    `review:   ${readiness.ok ? 'ready' : `not ready (${readiness.code}: ${readiness.reason})`}; approvals ${readiness.approvals}\n`,
  );
  process.stdout.write(
    `checks:   ${checks.total} total, ${checks.passing} passing, ${checks.failing} failing, ${checks.pending} pending\n`,
  );
  process.stdout.write(
    `merge:    ${pr.mergeable ?? 'unknown'} / ${pr.mergeStateStatus ?? 'unknown'}\n`,
  );
  if (blockers.length === 0) {
    process.stdout.write('blockers: none\n');
  } else {
    process.stdout.write('blockers:\n');
    for (const blocker of blockers) process.stdout.write(`  - ${blocker}\n`);
  }
  process.stdout.write(`next:     ${next}\n`);
}

function mergeCommand(pr, strategy, deleteBranch) {
  const args = ['pr', 'merge', String(pr.number), `--${strategy}`];
  if (deleteBranch) args.push('--delete-branch');
  return args;
}

function refreshMergeability(number) {
  let fresh = prView(number);
  for (let attempt = 0; attempt < 6 && fresh.mergeable === 'UNKNOWN'; attempt += 1) {
    sleepSync(2000);
    fresh = prView(number);
  }
  return fresh;
}

function main() {
  const { parsed, code } = parseCliResult(usage, (argv) =>
    parseArgs(argv, {
      flags: ['help', 'yes', 'json', 'delete-branch', 'self-reviewed', ...STRATEGIES],
    }),
  );
  if (code !== null) return code;
  if (parsed.positionals.length > 1) {
    process.stderr.write(`unexpected argument: ${parsed.positionals[1]}\n\n${usage}\n`);
    return 1;
  }

  const jsonMode = Boolean(parsed.flags.json);
  const yes = Boolean(parsed.flags.yes);
  const selfReviewed = Boolean(parsed.flags['self-reviewed']);
  const deleteBranch = Boolean(parsed.flags['delete-branch']);
  const selector = parsed.positionals[0] ?? null;

  try {
    explicitStrategy(parsed.flags);
  } catch (error) {
    fail(error.message, jsonMode);
  }

  let pr;
  try {
    pr = prView(selector);
  } catch (error) {
    fail(error.message, jsonMode);
  }

  if (pr.state === 'MERGED') {
    const result = {
      ok: true,
      alreadyMerged: true,
      merged: true,
      dryRun: false,
      pr: describePr(pr),
    };
    if (jsonMode) emitJson(result);
    else process.stdout.write(`PR #${pr.number} is already merged: ${pr.url}\n`);
    return 0;
  }

  let user;
  let permission;
  try {
    user = currentUser();
    permission = viewerPermission();
  } catch (error) {
    fail(error.message, jsonMode);
  }
  if (selfReviewed && !isMaintainer(permission)) {
    fail(
      `--self-reviewed requires ADMIN or MAINTAIN permission (you have ${permission ?? 'none'}).`,
      jsonMode,
    );
  }

  let strategy;
  try {
    strategy = strategyFor(pr, parsed.flags);
  } catch (error) {
    fail(error.message, jsonMode);
  }
  const readiness = reviewReadiness(pr, { currentUser: user, permission, selfReviewed });
  const checks = checkCounts(pr.statusCheckRollup);
  const blockers = blockersFor(pr, readiness, checks);
  const next = nextStep(pr, readiness, blockers);

  if (!yes) {
    const result = {
      ok: true,
      dryRun: true,
      alreadyMerged: false,
      pr: describePr(pr),
      strategy,
      deleteBranch,
      review: readiness,
      checks,
      blockers,
      next,
    };
    if (jsonMode) emitJson(result);
    else {
      process.stdout.write('Dry run: nothing will be merged.\n');
      printSummary(pr, strategy, readiness, checks, blockers, next, deleteBranch);
    }
    return 0;
  }

  if (pr.state === 'CLOSED') fail(`PR #${pr.number} is closed; nothing to merge.`, jsonMode);
  if (!readiness.ok) {
    fail(
      `review gate is not ready for PR #${pr.number}: ${readiness.reason}.\n` +
        `Review it first: pnpm pr:review ${pr.number}`,
      jsonMode,
      { pr: describePr(pr), review: readiness },
    );
  }

  try {
    runChecks(pr.number, { quiet: jsonMode });
  } catch (error) {
    fail(`${error.message}\nInspect the failing checks: pnpm ci:inspect ${pr.number}`, jsonMode, {
      pr: describePr(pr),
    });
  }

  let fresh;
  try {
    fresh = refreshMergeability(pr.number);
  } catch (error) {
    fail(error.message, jsonMode, { pr: describePr(pr) });
  }
  if (fresh.state === 'MERGED') {
    const result = {
      ok: true,
      alreadyMerged: true,
      merged: true,
      dryRun: false,
      pr: describePr(fresh),
    };
    if (jsonMode) emitJson(result);
    else process.stdout.write(`PR #${fresh.number} is already merged: ${fresh.url}\n`);
    return 0;
  }
  if (fresh.state !== 'OPEN')
    fail(`PR #${fresh.number} is ${fresh.state}; nothing to merge.`, jsonMode);
  const freshReadiness = reviewReadiness(fresh, { currentUser: user, permission, selfReviewed });
  if (!freshReadiness.ok) {
    fail(
      `review gate changed while checks ran: ${freshReadiness.reason}.\n` +
        `Review it first: pnpm pr:review ${fresh.number}`,
      jsonMode,
      { pr: describePr(fresh), review: freshReadiness },
    );
  }
  if (fresh.mergeable !== 'MERGEABLE') {
    fail(
      `PR #${fresh.number} is not mergeable (${fresh.mergeable ?? 'unknown'}). ` +
        'Resolve conflicts or retry when GitHub finishes computing mergeability.',
      jsonMode,
      { pr: describePr(fresh) },
    );
  }
  if (fresh.mergeStateStatus === 'DIRTY' || fresh.mergeStateStatus === 'BLOCKED') {
    fail(
      `PR #${fresh.number} merge state is ${fresh.mergeStateStatus}. ` +
        'Resolve it, or satisfy branch protection with a real approval.',
      jsonMode,
      { pr: describePr(fresh) },
    );
  }

  const args = mergeCommand(fresh, strategy, deleteBranch);
  const merge = gh(args);
  if (!merge.ok) {
    fail(
      `gh pr merge failed: ${merge.stderr || merge.stdout}\n` +
        'If branch protection requires approvals, ask a maintainer to review and approve.',
      jsonMode,
      { pr: describePr(fresh), strategy },
    );
  }

  let after = null;
  try {
    after = prView(fresh.number, 'number,title,url,state,mergedAt');
  } catch {
    after = null;
  }
  const finalState = after?.state ?? 'MERGED';
  const finalPr = { ...fresh, state: finalState, mergedAt: after?.mergedAt ?? null };
  const result = {
    ok: true,
    dryRun: false,
    alreadyMerged: false,
    merged: finalState === 'MERGED',
    pr: describePr(finalPr),
    state: finalState,
    mergedAt: finalPr.mergedAt,
    strategy,
    deleteBranch,
    review: freshReadiness,
    checks: checkCounts(fresh.statusCheckRollup),
  };
  if (jsonMode) emitJson(result);
  else {
    process.stdout.write(`Merged PR #${fresh.number} via ${strategy}. ${fresh.url}\n`);
    if (finalState !== 'MERGED') {
      process.stdout.write(
        `GitHub reports state ${finalState}; verify the PR before continuing.\n`,
      );
    }
  }
  return 0;
}

process.exitCode = main();
