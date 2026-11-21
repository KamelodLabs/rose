import { emitJson, gh, git, parseArgs } from './lib.mjs';

const usage = `Usage: node docs/scripts/release.mjs <vX.Y.Z> [--yes] [--json]

Validates main, CI and the tag, then creates an annotated tag and pushes it. Dry-run unless --yes.`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2), { flags: ['help', 'yes', 'json'] });
} catch (error) {
  fail(`${error.message}\n\n${usage}`);
}
if (parsed.flags.help) {
  process.stdout.write(`${usage}\n`);
  process.exit();
}

const tag = parsed.positionals[0];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) fail('tag must look like vX.Y.Z');

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (!branch.ok || branch.stdout !== 'main')
  fail(`switch to main first (currently ${branch.stdout})`);
const dirty = git(['status', '--porcelain']);
if (!dirty.ok || dirty.stdout) fail('working tree is not clean');
const fetched = git(['fetch', 'origin']);
if (!fetched.ok) fail(`git fetch failed: ${fetched.stderr || fetched.stdout}`);
const head = git(['rev-parse', 'HEAD']).stdout;
const remote = git(['rev-parse', 'origin/main']).stdout;
if (head !== remote) fail('local main is not at origin/main; sync first');
if (git(['rev-parse', '--verify', `refs/tags/${tag}`]).ok) fail(`tag ${tag} already exists`);

const runs = gh([
  'run',
  'list',
  '--branch',
  'main',
  '--commit',
  head,
  '--limit',
  '20',
  '--json',
  'databaseId,workflowName,conclusion,status,headSha',
]);
if (!runs.ok) fail(`could not inspect CI: ${runs.stderr || runs.stdout}`);
let ci = null;
try {
  const candidates = JSON.parse(runs.stdout).filter((run) => run.headSha === head);
  ci = candidates.find((run) => run.workflowName === 'CI') ?? candidates[0] ?? null;
} catch {
  ci = null;
}
if (!ci) fail(`no CI run found for ${head}`);
if (ci.conclusion !== 'success')
  fail(`CI for ${head} is ${ci.conclusion ?? ci.status}; refusing to tag`);

const plan = {
  dryRun: !parsed.flags.yes,
  tag,
  commit: head,
  ci: { workflow: ci.workflowName, id: ci.databaseId },
};
if (!parsed.flags.yes) {
  if (parsed.flags.json) emitJson({ ok: true, ...plan });
  else {
    process.stdout.write('Dry run: no tag will be created.\n');
    process.stdout.write(
      `tag:    ${tag}\ncommit: ${head}\nCI:     ${ci.workflowName} #${ci.databaseId}\n`,
    );
    process.stdout.write('Run with --yes to create and push the tag.\n');
  }
  process.exit();
}

const created = git(['tag', '-a', tag, '-m', tag]);
if (!created.ok) fail(`git tag failed: ${created.stderr || created.stdout}`);
const pushed = git(['push', 'origin', tag]);
if (!pushed.ok) fail(`git push tag failed: ${pushed.stderr || pushed.stdout}`);

const result = { ok: true, ...plan, dryRun: false };
if (parsed.flags.json) emitJson(result);
else process.stdout.write(`released ${tag} at ${head}\n`);
