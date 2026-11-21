import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const usage = `Usage: node docs/scripts/promote.mjs <name> [--yes] [--json]

Promote dev to staging, then staging to main, through the promote/<name> hybrid branch.
Without --yes this only prints the plan; nothing is fetched, branched, pushed, or merged.

Options:
  --yes    Execute the promotion through git and gh
  --json   Print only JSON to stdout (progress goes to stderr)
  --help   Show this help

Safety: no force-push, no direct pushes to protected branches.`;

class UsageError extends Error {}

function parseArgs(argv) {
  const flags = { yes: false, json: false, help: false };
  const positionals = [];
  for (const arg of argv) {
    if (arg === '--yes') flags.yes = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('-')) throw new UsageError(`unknown flag: ${arg}`);
    else positionals.push(arg);
  }
  if (positionals.length > 1) throw new UsageError(`unexpected argument: ${positionals[1]}`);
  return { name: positionals[0] ?? null, flags };
}

function runCommand(command, args) {
  try {
    const output = execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return output.trim();
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim();
    const stdout = String(error.stdout ?? '').trim();
    const detail = (stderr || stdout || error.message).split(/\r?\n/)[0];
    throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed: ${detail}`);
  }
}

function git(args) {
  return runCommand('git', args);
}

function gh(args) {
  return runCommand('gh', args);
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForChecks(number) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const view = gh(['pr', 'view', String(number), '--json', 'statusCheckRollup']);
    if (view.ok) {
      try {
        const rollup = JSON.parse(view.stdout).statusCheckRollup ?? [];
        if (rollup.length > 0) return;
      } catch {
        // Keep polling while the host registers the checks.
      }
    }
    sleepSync(5000);
  }
  throw new Error(`no checks appeared for PR #${number} within 300s`);
}

function planFor(name) {
  const branch = `promote/${name}`;
  const mergeMessage = `chore: promote ${name}`;
  const stagingTitle = `chore: promote ${name} to staging`;
  const mainTitle = `chore: promote ${name} to main`;
  let commits = [];
  try {
    commits = git(['log', '--oneline', '--no-decorate', 'origin/main..origin/dev'])
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    commits = [];
  }

  return {
    name,
    branch,
    base: 'origin/main',
    merge: { from: 'origin/dev', mode: '--no-ff', message: mergeMessage },
    prs: [
      { base: 'staging', head: branch, title: stagingTitle },
      { base: 'main', head: 'staging', title: mainTitle },
    ],
    commits,
    steps: [
      'git fetch origin',
      `git switch -C ${branch} origin/main`,
      `git merge --no-ff origin/dev -m "${mergeMessage}"`,
      `git push -u origin ${branch}`,
      `gh pr create --base staging --head ${branch} --title "${stagingTitle}" --body <commits>`,
      'gh pr checks <n> --watch --fail-fast',
      'gh pr merge <n> --merge',
      'git switch dev',
      `git branch -D ${branch} (ignore errors)`,
      `git push origin --delete ${branch} (ignore errors)`,
      `gh pr create --base main --head staging --title "${mainTitle}" --body <commits>`,
      'gh pr checks <n> --watch --fail-fast',
      'gh pr merge <n> --merge',
      'git switch dev',
      'git pull --ff-only',
    ],
  };
}

function printPlan(plan) {
  process.stdout.write('Dry run: no branches, pushes, or pull requests will be created.\n');
  process.stdout.write(`Name:    ${plan.name}\n`);
  process.stdout.write(`Branch:  ${plan.branch} (from ${plan.base})\n`);
  process.stdout.write(`Merge:   ${plan.merge.from} into ${plan.branch} (${plan.merge.mode})\n`);
  process.stdout.write(`Message: ${plan.merge.message}\n`);
  process.stdout.write(
    `PR 1:    ${plan.prs[0].head} -> ${plan.prs[0].base}  "${plan.prs[0].title}"\n`,
  );
  process.stdout.write(
    `PR 2:    ${plan.prs[1].head} -> ${plan.prs[1].base}  "${plan.prs[1].title}"\n`,
  );
  process.stdout.write(`Commits (${plan.commits.length}):\n`);
  if (plan.commits.length === 0) {
    process.stdout.write('  (none found between origin/main and origin/dev; --yes would refuse)\n');
  } else {
    for (const commit of plan.commits) process.stdout.write(`  ${commit}\n`);
  }
  process.stdout.write('Run with --yes to execute.\n');
}

function prNumberFrom(url) {
  const match = /\/pull\/(\d+)/.exec(url);
  if (!match) throw new Error(`could not read a PR number from gh output: ${url}`);
  return Number(match[1]);
}

function execute(name, jsonMode) {
  const branch = `promote/${name}`;
  const mergeMessage = `chore: promote ${name}`;
  const stagingTitle = `chore: promote ${name} to staging`;
  const mainTitle = `chore: promote ${name} to main`;
  const prs = [];
  let stage = 'preflight';

  const say = (message) => {
    const stream = jsonMode ? process.stderr : process.stdout;
    stream.write(`${message}\n`);
  };

  try {
    const dirty = git(['status', '--porcelain']);
    if (dirty) throw new Error('working tree is not clean; commit or stash changes first');

    const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (current !== 'dev') throw new Error(`current branch is ${current}; switch to dev first`);

    gh(['auth', 'status']);
    git(['fetch', 'origin']);

    const count = Number(git(['rev-list', '--count', 'origin/main..origin/dev']));
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error('nothing to promote: origin/main..origin/dev is empty');
    }
    const body = git(['log', '--oneline', '--no-decorate', 'origin/main..origin/dev']);

    stage = 'branch';
    say(`Creating ${branch} from origin/main...`);
    git(['switch', '-C', branch, 'origin/main']);
    say(`Merging origin/dev into ${branch}...`);
    git(['merge', '--no-ff', 'origin/dev', '-m', mergeMessage]);
    say(`Pushing ${branch}...`);
    git(['push', '-u', 'origin', branch]);

    stage = 'staging-pr';
    say('Opening the staging pull request...');
    const stagingUrl = gh([
      'pr',
      'create',
      '--base',
      'staging',
      '--head',
      branch,
      '--title',
      stagingTitle,
      '--body',
      body,
    ]);
    const stagingNumber = prNumberFrom(stagingUrl);
    prs.push({
      base: 'staging',
      head: branch,
      title: stagingTitle,
      number: stagingNumber,
      url: stagingUrl,
    });
    say(`PR #${stagingNumber}: ${stagingUrl}`);

    stage = 'staging-checks';
    say(`Waiting for checks on PR #${stagingNumber}...`);
    waitForChecks(stagingNumber);
    const stagingChecks = gh(['pr', 'checks', String(stagingNumber), '--watch', '--fail-fast']);
    if (stagingChecks) say(stagingChecks);

    stage = 'staging-merge';
    say(`Merging PR #${stagingNumber} into staging...`);
    gh(['pr', 'merge', String(stagingNumber), '--merge']);
    prs[0].merged = true;

    stage = 'cleanup';
    git(['switch', 'dev']);
    try {
      git(['branch', '-D', branch]);
    } catch (error) {
      say(`note: ${error.message}`);
    }
    try {
      git(['push', 'origin', '--delete', branch]);
    } catch (error) {
      say(`note: ${error.message}`);
    }

    stage = 'main-pr';
    say('Opening the main pull request...');
    const mainUrl = gh([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      'staging',
      '--title',
      mainTitle,
      '--body',
      body,
    ]);
    const mainNumber = prNumberFrom(mainUrl);
    prs.push({ base: 'main', head: 'staging', title: mainTitle, number: mainNumber, url: mainUrl });
    say(`PR #${mainNumber}: ${mainUrl}`);

    stage = 'main-checks';
    say(`Waiting for checks on PR #${mainNumber}...`);
    waitForChecks(mainNumber);
    const mainChecks = gh(['pr', 'checks', String(mainNumber), '--watch', '--fail-fast']);
    if (mainChecks) say(mainChecks);

    stage = 'main-merge';
    say(`Merging PR #${mainNumber} into main...`);
    gh(['pr', 'merge', String(mainNumber), '--merge']);
    prs[1].merged = true;

    stage = 'sync';
    git(['switch', 'dev']);
    git(['pull', '--ff-only']);

    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify(
          { ok: true, name, branch, mergedAt: new Date().toISOString(), prs },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(
        `Promoted ${name}. PRs: ${prs.map((pr) => `#${pr.number}`).join(', ')}\n`,
      );
    }
    return 0;
  } catch (error) {
    const pr = prs[prs.length - 1];
    process.stderr.write(`Promotion stopped at ${stage}: ${error.message}\n`);
    if (pr) {
      process.stderr.write(`PR: ${pr.url}\n`);
      process.stderr.write(`Next: fix the failing checks, then run:\n`);
      process.stderr.write(
        `  gh pr checks ${pr.number} --watch --fail-fast && gh pr merge ${pr.number} --merge\n`,
      );
    } else {
      process.stderr.write('No pull request was created and nothing was force-pushed.\n');
    }
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, name, stage, error: error.message, prs }, null, 2)}\n`,
      );
    }
    return 1;
  }
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage}\n`);
    return 1;
  }

  if (parsed.flags.help) {
    const stream = parsed.flags.json ? process.stderr : process.stdout;
    stream.write(`${usage}\n`);
    return 0;
  }
  if (!parsed.name) {
    process.stderr.write(`${usage}\n`);
    return 1;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parsed.name)) {
    process.stderr.write('name must match ^[A-Za-z0-9][A-Za-z0-9._-]*$\n');
    return 1;
  }

  if (!parsed.flags.yes) {
    const plan = planFor(parsed.name);
    if (parsed.flags.json) {
      process.stdout.write(`${JSON.stringify({ dryRun: true, ...plan }, null, 2)}\n`);
    } else {
      printPlan(plan);
    }
    return 0;
  }

  return execute(parsed.name, parsed.flags.json);
}

process.exitCode = main();
