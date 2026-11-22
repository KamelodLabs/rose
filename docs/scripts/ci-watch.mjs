import { emitJson, gh, parseArgs, parseCliResult } from './lib.mjs';
import { prView, runChecks } from './pr-lib.mjs';

const usage = `Usage: node docs/scripts/ci-watch.mjs [<number|url|branch>] [--interval <seconds>] [--json]

Watches PR checks with gh --watch --fail-fast. No static timeout: gh waits until checks settle.
Defaults to the PR for the current branch.`;

function fail(message, jsonMode) {
  process.stderr.write(`${message}\n`);
  if (jsonMode) emitJson({ ok: false, error: message, pr: null, checks: [] });
  process.exit(1);
}

function main() {
  const { parsed, code } = parseCliResult(usage, (argv) =>
    parseArgs(argv, {
      flags: ['help', 'json'],
      values: ['interval'],
    }),
  );
  if (code !== null) return code;
  if (parsed.positionals.length > 1) {
    process.stderr.write(`unexpected argument: ${parsed.positionals[1]}\n\n${usage}\n`);
    return 1;
  }

  const jsonMode = Boolean(parsed.flags.json);
  const interval = parsed.values.interval;
  if (interval !== undefined && (!/^\d+$/.test(interval) || Number(interval) <= 0)) {
    fail('--interval must be a positive number of seconds', jsonMode);
  }
  const selector = parsed.positionals[0] ?? null;

  let pr;
  try {
    pr = prView(selector, 'number,title,url,state');
  } catch (error) {
    fail(error.message, jsonMode);
  }

  if (!jsonMode) {
    try {
      runChecks(pr.number, { interval });
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    return 0;
  }

  let watchError = null;
  try {
    runChecks(pr.number, { interval, quiet: true });
  } catch (error) {
    watchError = error.message;
    process.stderr.write(`${watchError}\n`);
  }

  const listed = gh([
    'pr',
    'checks',
    String(pr.number),
    '--json',
    'name,state,bucket,link,workflow',
  ]);
  let checks = [];
  let checksError = null;
  try {
    checks = JSON.parse(listed.stdout);
  } catch {
    checksError = (listed.stderr || listed.stdout || 'could not read checks').trim();
  }

  emitJson({
    ok: !watchError,
    pr: { number: pr.number, url: pr.url },
    checks,
    ...(watchError ? { error: watchError } : {}),
    ...(checksError ? { checksError } : {}),
  });
  return watchError ? 1 : 0;
}

process.exitCode = main();
