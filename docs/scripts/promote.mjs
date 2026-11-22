import { emitJson, firstLine, gh, git, parseArgs, parseCliResult } from './lib.mjs';
import {
  checkCounts,
  currentUser,
  describePr,
  findPromotion,
  isMaintainer,
  prView,
  promotionStage,
  reviewReadiness,
  runChecks,
  viewerPermission,
} from './pr-lib.mjs';

const usage = `Usage: node docs/scripts/promote.mjs <name> [--resume] [--self-reviewed] [--yes] [--json]

Promotes dev to staging, then staging to main, through promote/<name>. Every PR is reviewed
before merge: the script pauses at the review gate and resumes with --resume.

Options:
  --resume         Continue an existing promotion
  --self-reviewed  Maintainer self-review for the current gate (ADMIN/MAINTAIN only)
  --yes            Execute; without it this is a read-only plan
  --json           Progress to stderr, final JSON to stdout
  --help           Show this help

Safety: no --auto, no --admin, no force-push, no direct pushes to protected branches.`;

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function parsePromote(argv) {
  const parsed = parseArgs(argv, {
    flags: ['resume', 'self-reviewed', 'yes', 'json'],
  });
  if (parsed.positionals.length > 1) {
    throw new Error(`unexpected argument: ${parsed.positionals[1]}`);
  }
  if (parsed.flags.help) return { ...parsed, name: null };
  const name = parsed.positionals[0] ?? null;
  if (!name) throw new Error('missing <name>');
  if (!NAME_PATTERN.test(name)) throw new Error('name must match ^[A-Za-z0-9][A-Za-z0-9._-]*$');
  return { ...parsed, name };
}

function resultFor(name) {
  return { ok: true, name, stage: 'not-started', paused: false, done: false, prs: [], next: null };
}

function trackPr(result, pr, extra = {}) {
  if (!pr) return null;
  const entry = { ...describePr(pr), ...extra };
  const index = result.prs.findIndex((item) => item.number === entry.number);
  if (index >= 0) result.prs[index] = { ...result.prs[index], ...entry };
  else result.prs.push(entry);
  return entry;
}

function detail(outcome, label) {
  return `${label}: ${firstLine(outcome.stderr || outcome.stdout) || 'unknown error'}`;
}

function check(outcome, label) {
  if (!outcome.ok) throw new Error(detail(outcome, label));
  return outcome.stdout;
}

function preflight() {
  const dirty = git(['status', '--porcelain']);
  if (!dirty.ok) throw new Error(detail(dirty, 'git status failed'));
  if (dirty.stdout) throw new Error('working tree is not clean; commit or stash changes first');
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!current.ok) throw new Error(detail(current, 'could not read the current branch'));
  if (current.stdout !== 'dev') {
    throw new Error(`current branch is ${current.stdout}; switch to dev first`);
  }
  check(gh(['auth', 'status']), 'gh auth status failed');
  check(git(['fetch', 'origin']), 'git fetch origin failed');
}

function reviewContext(selfReviewed) {
  const user = currentUser();
  const permission = viewerPermission();
  if (selfReviewed && !isMaintainer(permission)) {
    throw new Error(
      `--self-reviewed requires ADMIN or MAINTAIN permission (you have ${permission ?? 'none'})`,
    );
  }
  return { currentUser: user, permission, selfReviewed, maintainer: isMaintainer(permission) };
}

function readinessFor(pr, context) {
  return reviewReadiness(pr, {
    currentUser: context.currentUser,
    permission: context.permission,
    selfReviewed: context.selfReviewed,
  });
}

function ensureDevBranch() {
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!current.ok) throw new Error(detail(current, 'could not read the current branch'));
  if (current.stdout === 'dev') return;
  check(git(['switch', 'dev']), 'git switch dev failed');
}

function pauseForReview(result, pr, context, name, say, { created = false } = {}) {
  ensureDevBranch();
  result.paused = true;
  const base = pr.baseRefName ?? pr.base;
  result.stage = base === 'main' ? 'main-review' : 'staging-review';
  result.next = `pnpm pr:review ${pr.number}`;
  say(`Review required for PR #${pr.number}: ${pr.url}`);
  say(`  Read-only summary: pnpm pr:review ${pr.number}`);
  const author = pr.author?.login ?? (typeof pr.author === 'string' ? pr.author : null);
  if (context.currentUser === author) {
    if (context.maintainer) {
      say(`  After reviewing: pnpm promote ${name} --resume --yes --self-reviewed`);
    } else {
      say('  A non-author approval is required; ask a maintainer to review.');
    }
  } else {
    say(`  Approve when ready: pnpm pr:review ${pr.number} -- --approve -b "..."`);
  }
  if (created) say('The new PR requires review for this gate, even when --self-reviewed is set.');
  return result;
}

function runChecksFor(pr, jsonMode, say) {
  say(`Waiting for checks on PR #${pr.number}...`);
  try {
    runChecks(pr.number, { quiet: jsonMode });
  } catch (error) {
    throw new Error(`${error.message}\nInspect the failing checks: pnpm ci:inspect ${pr.number}`);
  }
}

function mergePr(pr, say, result) {
  say(`Merging PR #${pr.number} with --merge...`);
  const merged = gh(['pr', 'merge', String(pr.number), '--merge']);
  if (!merged.ok) {
    throw new Error(
      `${detail(merged, `gh pr merge #${pr.number} failed`)}\n` +
        'If branch protection requires approvals, ask a maintainer to review and approve.',
    );
  }
  trackPr(result, { ...pr, state: 'MERGED' });
  return { ...pr, state: 'MERGED' };
}

function cleanupBranch(name, say) {
  check(git(['switch', 'dev']), 'git switch dev failed');
  const branch = `promote/${name}`;
  const local = git(['branch', '-D', branch]);
  if (!local.ok)
    say(`note: could not delete local ${branch}: ${firstLine(local.stderr || local.stdout)}`);
  const remote = git(['push', 'origin', '--delete', branch]);
  if (!remote.ok)
    say(`note: could not delete origin/${branch}: ${firstLine(remote.stderr || remote.stdout)}`);
}

function syncDev(say) {
  check(git(['switch', 'dev']), 'git switch dev failed');
  const fetch = git(['fetch', 'origin']);
  if (!fetch.ok) say(`note: git fetch origin failed: ${firstLine(fetch.stderr)}`);
  const pull = git(['pull', '--ff-only']);
  if (!pull.ok) say(`note: could not fast-forward dev: ${firstLine(pull.stderr)}`);
}

function repositoryBody(from, to, fallback) {
  const log = git(['log', '--oneline', '--no-decorate', `${from}..${to}`]);
  return log.ok && log.stdout ? log.stdout : fallback;
}

function createPr({ base, head, title, body }) {
  const created = gh([
    'pr',
    'create',
    '--base',
    base,
    '--head',
    head,
    '--title',
    title,
    '--body',
    body,
  ]);
  if (!created.ok) throw new Error(detail(created, 'gh pr create failed'));
  const match = /(https?:\/\/\S+\/pull\/(\d+))/.exec(created.stdout);
  if (!match)
    throw new Error(`could not read a PR URL from gh output: ${firstLine(created.stdout)}`);
  return { number: Number(match[2]), url: match[1] };
}

function afterStaging(name, context, result, say, jsonMode) {
  cleanupBranch(name, say);
  const fetched = git(['fetch', 'origin']);
  if (!fetched.ok) say(`note: git fetch origin failed: ${firstLine(fetched.stderr)}`);
  const promotion = findPromotion(name);
  let mainPr = promotion.main;
  if (mainPr) trackPr(result, mainPr);
  let created = false;
  if (mainPr?.state === 'MERGED') {
    result.done = true;
    result.stage = 'done';
    result.next = 'complete';
    syncDev(say);
    return result;
  }
  if (mainPr?.state === 'CLOSED') {
    throw new Error('the previous main PR was closed without merging; use a new promotion name');
  }
  if (!mainPr) {
    say('Opening the main pull request...');
    const body = repositoryBody('origin/main', 'origin/staging', `chore: promote ${name} to main`);
    const fresh = createPr({
      base: 'main',
      head: 'staging',
      title: `chore: promote ${name} to main`,
      body,
    });
    mainPr = {
      number: fresh.number,
      url: fresh.url,
      title: `chore: promote ${name} to main`,
      state: 'OPEN',
      baseRefName: 'main',
      headRefName: 'staging',
      author: { login: context.currentUser },
    };
    created = true;
  }
  trackPr(result, mainPr);
  result.stage = 'main-pr';
  say(`PR #${mainPr.number}: ${mainPr.url}`);
  runChecksFor(mainPr, jsonMode, say);
  return pauseForReview(result, mainPr, context, name, say, { created });
}

function freshRun(name, context, result, say, jsonMode) {
  const promotion = findPromotion(name);
  const stage = promotionStage(promotion);
  if (stage === 'done') {
    throw new Error(`promotion ${name} is already complete; nothing to promote`);
  }
  if (stage === 'staging-closed') {
    throw new Error('the previous staging PR was closed without merging; use a new name');
  }
  if (stage !== 'not-started') {
    throw new Error('promotion already in progress; use --resume');
  }

  const count = Number(git(['rev-list', '--count', 'origin/staging..origin/dev']).stdout);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('nothing to promote: origin/staging..origin/dev is empty');
  }

  const branch = `promote/${name}`;
  result.stage = 'branch';
  say(`Creating ${branch} from origin/staging...`);
  check(git(['switch', '-C', branch, 'origin/staging']), 'git switch failed');
  say(`Merging origin/dev into ${branch}...`);
  check(
    git(['merge', '--no-ff', 'origin/dev', '-m', `chore: promote ${name}`]),
    'git merge failed',
  );
  say(`Pushing ${branch}...`);
  check(git(['push', '-u', 'origin', branch]), 'git push failed');

  result.stage = 'staging-pr';
  say('Opening the staging pull request...');
  const body = repositoryBody('origin/staging', 'origin/dev', `chore: promote ${name} to staging`);
  const created = createPr({
    base: 'staging',
    head: branch,
    title: `chore: promote ${name} to staging`,
    body,
  });
  const staging = trackPr(result, {
    number: created.number,
    url: created.url,
    title: `chore: promote ${name} to staging`,
    state: 'OPEN',
    baseRefName: 'staging',
    headRefName: branch,
    author: { login: context.currentUser },
  });
  say(`PR #${staging.number}: ${staging.url}`);

  result.stage = 'staging-checks';
  runChecksFor(staging, jsonMode, say);
  const stagingPr = prView(created.number);
  trackPr(result, stagingPr);
  result.stage = 'staging-review';
  return pauseForReview(result, stagingPr, context, name, say, { created: true });
}

function resumeRun(name, context, result, say, jsonMode) {
  const promotion = findPromotion(name);
  const stage = promotionStage(promotion);
  if (stage === 'not-started') throw new Error(`nothing to resume: no promotion for ${name}`);
  if (stage === 'done') throw new Error(`nothing to resume: ${name} is already promoted`);
  if (stage === 'staging-closed') {
    throw new Error('the staging PR was closed without merging; open a new promotion');
  }

  if (stage === 'staging-review') {
    const stagingPr = promotion.staging;
    trackPr(result, stagingPr);
    result.stage = 'staging-review';
    runChecksFor(stagingPr, jsonMode, say);
    const readiness = readinessFor(stagingPr, context);
    if (!readiness.ok) return pauseForReview(result, stagingPr, context, name, say);
    result.stage = 'staging-merge';
    mergePr(stagingPr, say, result);
    return afterStaging(name, context, result, say, jsonMode);
  }

  if (stage === 'main-pr-missing') {
    say('Staging is merged; preparing the main pull request...');
    result.stage = 'main-pr';
    return afterStaging(name, context, result, say, jsonMode);
  }

  if (stage === 'main-review') {
    const mainPr = promotion.main;
    trackPr(result, mainPr);
    result.stage = 'main-review';
    runChecksFor(mainPr, jsonMode, say);
    const readiness = readinessFor(mainPr, context);
    if (!readiness.ok) return pauseForReview(result, mainPr, context, name, say);
    result.stage = 'main-merge';
    mergePr(mainPr, say, result);
    result.done = true;
    result.stage = 'done';
    result.next = 'complete';
    say('Syncing dev...');
    syncDev(say);
    return result;
  }

  throw new Error(`unexpected promotion stage: ${stage}`);
}

function printResult(result, jsonMode, dryRun = false) {
  if (jsonMode) {
    emitJson(result);
    return;
  }
  process.stdout.write(`${dryRun ? 'Dry run: no changes will be made.\n' : ''}`);
  process.stdout.write(`name:  ${result.name}\n`);
  process.stdout.write(`stage: ${result.stage}\n`);
  if (result.prs.length > 0) {
    process.stdout.write('prs:\n');
    for (const pr of result.prs) {
      process.stdout.write(`  #${pr.number} ${pr.head} -> ${pr.base} ${pr.state} ${pr.url}\n`);
    }
  } else {
    process.stdout.write('prs:   none\n');
  }
  if (Array.isArray(result.commits)) {
    process.stdout.write(`commits: ${result.commits.length}\n`);
    for (const commit of result.commits.slice(0, 20)) process.stdout.write(`  ${commit}\n`);
  }
  if (result.plan) {
    process.stdout.write(`plan:  ${result.plan.branch} from ${result.plan.base}\n`);
    for (const pr of result.plan.prs) {
      process.stdout.write(`  ${pr.head} -> ${pr.base}  "${pr.title}"\n`);
    }
    for (const gate of result.plan.reviewGates) process.stdout.write(`  review: ${gate}\n`);
  }
  if (result.nothingToPromote) process.stdout.write('nothing to promote.\n');
  if (result.paused) process.stdout.write('paused for review.\n');
  if (result.done) process.stdout.write('promotion complete.\n');
  if (result.error) process.stdout.write(`error: ${result.error}\n`);
  process.stdout.write(`next:  ${result.next ?? 'none'}\n`);
}

function dryRun(name, flags, jsonMode) {
  const result = { ...resultFor(name), dryRun: true, commits: [] };
  let promotion = null;
  let stage = 'not-started';
  let ghError = null;
  try {
    promotion = findPromotion(name);
    stage = promotionStage(promotion);
  } catch (error) {
    ghError = error.message;
  }
  result.stage = stage;
  result.done = stage === 'done';
  if (ghError) result.ghError = ghError;

  if (flags['self-reviewed']) {
    try {
      const permission = viewerPermission();
      if (!isMaintainer(permission)) {
        result.ok = false;
        result.error =
          `--self-reviewed requires ADMIN or MAINTAIN permission ` +
          `(you have ${permission ?? 'none'})`;
        process.stderr.write(`${result.error}\n`);
        printResult(result, jsonMode, true);
        return 1;
      }
    } catch (error) {
      result.ok = false;
      result.error = error.message;
      process.stderr.write(`${result.error}\n`);
      printResult(result, jsonMode, true);
      return 1;
    }
  }

  if (promotion) {
    trackPr(result, promotion.staging);
    trackPr(result, promotion.main);
    try {
      const context = {
        currentUser: currentUser(),
        permission: viewerPermission(),
      };
      for (const pr of [promotion.staging, promotion.main]) {
        if (pr?.state === 'OPEN') {
          trackPr(result, pr, {
            checks: checkCounts(pr.statusCheckRollup),
            review: reviewReadiness(pr, {
              ...context,
              selfReviewed: Boolean(flags['self-reviewed']),
            }),
          });
        }
      }
    } catch {
      // Review readiness is best-effort in a read-only plan.
    }
  }

  if (flags.resume) {
    if (ghError) {
      result.ok = false;
      result.error = ghError;
    } else if (stage === 'not-started') {
      result.ok = false;
      result.error = `nothing to resume: no promotion for ${name}`;
    } else if (stage === 'done') {
      result.ok = false;
      result.error = `nothing to resume: ${name} is already promoted`;
    } else if (stage === 'staging-closed') {
      result.ok = false;
      result.error = 'the staging PR was closed without merging; open a new promotion';
    }
    if (!result.ok) {
      process.stderr.write(`${result.error}\n`);
      printResult(result, jsonMode, true);
      return 1;
    }
  }

  if (!flags.resume && flags['self-reviewed'] && stage === 'not-started') {
    result.ok = false;
    result.error = 'create the staging PR first, review it, then use --resume --self-reviewed';
    process.stderr.write(`${result.error}\n`);
    printResult(result, jsonMode, true);
    return 1;
  }

  const log = git(['log', '--oneline', '--no-decorate', 'origin/staging..origin/dev']);
  result.commits = log.ok ? log.stdout.split(/\r?\n/).filter(Boolean) : [];
  const selfFlag = flags['self-reviewed'] ? ' --self-reviewed' : '';

  if (stage === 'not-started') {
    result.nothingToPromote = result.commits.length === 0;
    result.next = result.nothingToPromote ? null : `pnpm promote ${name} --yes`;
    result.plan = {
      branch: `promote/${name}`,
      base: 'origin/staging',
      merge: { from: 'origin/dev', mode: '--no-ff', message: `chore: promote ${name}` },
      prs: [
        {
          base: 'staging',
          head: `promote/${name}`,
          title: `chore: promote ${name} to staging`,
        },
        { base: 'main', head: 'staging', title: `chore: promote ${name} to main` },
      ],
      reviewGates: ['staging PR requires review', 'the new main PR always requires review'],
    };
  } else if (stage === 'done') {
    result.next = 'complete';
  } else if (stage === 'staging-closed') {
    result.next = 'use a new promotion name';
  } else {
    const base = stage === 'main-review' ? 'main' : 'staging';
    const active = result.prs.find((pr) => pr.base === base && pr.state === 'OPEN');
    if (active?.checks?.failing > 0) {
      result.next = `pnpm ci:inspect ${active.number}`;
    } else if (active?.checks && (active.checks.total === 0 || active.checks.pending > 0)) {
      result.next = `pnpm ci:watch ${active.number}`;
    } else if (active?.review && !active.review.ok) {
      result.next = `pnpm pr:review ${active.number}`;
    } else {
      result.next = `pnpm promote ${name} --resume --yes${selfFlag}`;
    }
  }

  printResult(result, jsonMode, true);
  return 0;
}

function execute(name, flags, jsonMode) {
  const result = resultFor(name);
  const say = (message) => (jsonMode ? process.stderr : process.stdout).write(`${message}\n`);
  try {
    preflight();
    if (!flags.resume && flags['self-reviewed']) {
      throw new Error('create the staging PR first, review it, then use --resume --self-reviewed');
    }
    const context = reviewContext(Boolean(flags['self-reviewed']));
    const outcome = flags.resume
      ? resumeRun(name, context, result, say, jsonMode)
      : freshRun(name, context, result, say, jsonMode);
    printResult(outcome, jsonMode);
    return 0;
  } catch (error) {
    process.stderr.write(`Promotion stopped at ${result.stage}: ${error.message}\n`);
    result.ok = false;
    result.error = error.message;
    if (!result.next) {
      if (result.done) result.next = 'complete';
      else if (result.prs.length > 0) result.next = `pnpm promote ${name} --resume --yes`;
    }
    printResult(result, jsonMode);
    return 1;
  }
}

function main() {
  const { parsed, code } = parseCliResult(usage, parsePromote);
  if (code !== null) return code;
  if (!parsed.flags.yes) return dryRun(parsed.name, parsed.flags, parsed.flags.json);
  return execute(parsed.name, parsed.flags, parsed.flags.json);
}

process.exitCode = main();
