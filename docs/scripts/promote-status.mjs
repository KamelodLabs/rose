import { emitJson, parseArgs } from './lib.mjs';
import {
  checkCounts,
  currentUser,
  describePr,
  findPromotion,
  isMaintainer,
  promotionStage,
  reviewReadiness,
  viewerPermission,
} from './pr-lib.mjs';

const usage = `Usage: node docs/scripts/promote-status.mjs <name> [--json]

Read-only promotion status: staging and main PRs, checks, review gates, and the next action.`;

function fail(message, jsonMode, extra = {}) {
  process.stderr.write(`${message}\n`);
  if (jsonMode) emitJson({ ok: false, error: message, ...extra });
  process.exit(1);
}

function summarize(pr, user, permission) {
  if (!pr) return null;
  const summary = { ...describePr(pr), checks: checkCounts(pr.statusCheckRollup) };
  if (pr.state === 'OPEN') {
    summary.review = reviewReadiness(pr, {
      currentUser: user,
      permission,
      selfReviewed: false,
    });
  }
  return summary;
}

function checksNext(pr) {
  if (pr.checks.failing > 0) return `pnpm ci:inspect ${pr.number}`;
  if (pr.checks.total === 0 || pr.checks.pending > 0) return `pnpm ci:watch ${pr.number}`;
  return null;
}

function reviewNext(name, pr, user, permission) {
  if (pr.review?.ok) return null;
  if (pr.author === user && isMaintainer(permission)) {
    return `pnpm pr:review ${pr.number} -- --comment -b "self-review", then pnpm promote ${name} --resume --yes --self-reviewed`;
  }
  return `pnpm pr:review ${pr.number}, then pnpm promote ${name} --resume --yes`;
}

function nextAction(name, stage, staging, main, user, permission) {
  if (stage === 'not-started') return `pnpm promote ${name}`;
  if (stage === 'done') return 'complete';
  if (stage === 'staging-closed') {
    return 'the staging PR was closed without merging; open a new promotion';
  }
  if (stage === 'staging-review') {
    if (!staging) return `pnpm promote ${name} --resume --yes`;
    return (
      checksNext(staging) ??
      reviewNext(name, staging, user, permission) ??
      `pnpm promote ${name} --resume --yes`
    );
  }
  if (stage === 'main-pr-missing') return `pnpm promote ${name} --resume --yes`;
  if (stage === 'main-review') {
    if (!main) return `pnpm promote ${name} --resume --yes`;
    return (
      checksNext(main) ??
      reviewNext(name, main, user, permission) ??
      `pnpm promote ${name} --resume --yes`
    );
  }
  return `pnpm promote ${name}`;
}

function printSummary(result) {
  process.stdout.write(`name:   ${result.name}\n`);
  process.stdout.write(`branch: ${result.branch}\n`);
  process.stdout.write(`stage:  ${result.stage}${result.done ? ' (complete)' : ''}\n`);
  for (const key of ['staging', 'main']) {
    const pr = result.prs[key];
    if (!pr) {
      process.stdout.write(`${key}:  none\n`);
      continue;
    }
    process.stdout.write(`${key}:  #${pr.number} ${pr.state} ${pr.url}\n`);
    process.stdout.write(
      `        checks ${pr.checks.total}: ${pr.checks.passing} passing, ` +
        `${pr.checks.failing} failing, ${pr.checks.pending} pending\n`,
    );
    if (pr.review) {
      process.stdout.write(
        `        review ${pr.review.ok ? 'ready' : `not ready (${pr.review.code})`}; ` +
          `approvals ${pr.review.approvals}\n`,
      );
    }
  }
  process.stdout.write(`next:   ${result.next}\n`);
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2), { flags: ['help', 'json'] });
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage}\n`);
    return 1;
  }
  if (parsed.flags.help) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (parsed.positionals.length !== 1) {
    process.stderr.write(`expected exactly one <name>\n\n${usage}\n`);
    return 1;
  }
  const jsonMode = Boolean(parsed.flags.json);
  const name = parsed.positionals[0];

  let promotion;
  try {
    promotion = findPromotion(name);
  } catch (error) {
    fail(error.message, jsonMode, { name });
  }
  const stage = promotionStage(promotion);

  let user = null;
  let permission = null;
  try {
    user = currentUser();
    permission = viewerPermission();
  } catch (error) {
    if (stage !== 'not-started' && stage !== 'done') fail(error.message, jsonMode, { name });
  }

  const staging = summarize(promotion.staging, user, permission);
  const main = summarize(promotion.main, user, permission);
  const result = {
    ok: true,
    name,
    branch: promotion.branch,
    stage,
    done: stage === 'done',
    prs: { staging, main },
    next: nextAction(name, stage, staging, main, user, permission),
  };

  if (jsonMode) emitJson(result);
  else printSummary(result);
  return 0;
}

process.exitCode = main();
