import { readFileSync } from 'node:fs';
import { emitJson, gh, git, parseArgs, runPnpm } from './lib.mjs';

const usage = `Usage: node docs/scripts/pr-open.mjs [--title <title>] [--body-file <path>]
       [--base dev] [--draft] [--verify] [--yes] [--json]

Without --yes this only prints the plan. It never pushes or opens a PR in dry-run mode.`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2), {
    flags: ['help', 'draft', 'verify', 'yes', 'json'],
    values: ['title', 'body-file', 'base'],
  });
} catch (error) {
  fail(`${error.message}\n\n${usage}`);
  process.exit();
}

if (parsed.flags.help) {
  process.stdout.write(`${usage}\n`);
  process.exit();
}

const base = parsed.values.base ?? 'dev';
const jsonMode = parsed.flags.json;
const branchResult = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (!branchResult.ok) fail('not a git repository');
const branch = branchResult.stdout;
if (['dev', 'staging', 'main'].includes(branch)) fail(`refusing to open a PR from ${branch}`);
const dirty = git(['status', '--porcelain']);
if (!dirty.ok || dirty.stdout) fail('working tree is not clean; commit or stash changes first');

const title =
  parsed.values.title ?? git(['log', '-1', '--format=%s']).stdout ?? `chore: update ${branch}`;
const bodyFile = parsed.values['body-file'];
let body = bodyFile ? readFileSync(bodyFile, 'utf8').trim() : '';
if (!body) {
  const commits = git(['log', '--oneline', '--no-decorate', `origin/${base}..HEAD`]);
  body = commits.ok ? commits.stdout : '';
}

const existing = gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url']);
if (existing.ok) {
  try {
    const pr = JSON.parse(existing.stdout)[0];
    if (pr) {
      const result = {
        ok: true,
        existing: true,
        number: pr.number,
        url: pr.url,
        branch,
        base,
        next: `pnpm pr:review ${pr.number}`,
      };
      if (jsonMode) emitJson(result);
      else {
        process.stdout.write(`PR already open: #${pr.number} ${pr.url}\n`);
        process.stdout.write(`Next: pnpm pr:review ${pr.number}\n`);
      }
      process.exit();
    }
  } catch {
    // Fall through to the normal path when gh output is unexpected.
  }
}

const plan = {
  dryRun: !parsed.flags.yes,
  branch,
  base,
  title,
  body,
  draft: Boolean(parsed.flags.draft),
  verify: Boolean(parsed.flags.verify),
};

if (!parsed.flags.yes) {
  if (jsonMode) {
    emitJson(plan);
  } else {
    process.stdout.write('Dry run: nothing will be pushed or opened.\n');
    process.stdout.write(`Branch: ${branch} -> ${base}\nTitle:  ${title}\n`);
    if (plan.verify) process.stdout.write('Verify: pnpm verify (before push)\n');
    process.stdout.write('Run with --yes to push and open the PR.\n');
  }
  process.exit();
}

if (parsed.flags.verify) {
  const verify = runPnpm(['verify'], { timeout: 900_000 });
  if (!verify.ok) fail(`pnpm verify failed:\n${verify.stderr || verify.stdout}`);
}

const push = git(['push', '-u', 'origin', branch]);
if (!push.ok) fail(`git push failed: ${push.stderr || push.stdout}`);

const args = ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body];
if (parsed.flags.draft) args.push('--draft');
const created = gh(args);
if (!created.ok) fail(`gh pr create failed: ${created.stderr || created.stdout}`);

const url = created.stdout.trim();
const match = /\/pull\/(\d+)/.exec(url);
const number = match ? Number(match[1]) : null;
const result = {
  ok: true,
  branch,
  base,
  title,
  url,
  number,
  next: number ? `pnpm pr:review ${number}` : 'pnpm pr:review',
};
if (jsonMode) emitJson(result);
else {
  process.stdout.write(`PR created: ${url}\n`);
  process.stdout.write(`Next: ${result.next}\n`);
}
