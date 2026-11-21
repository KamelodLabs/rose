import { emitJson, gh, git, printTable } from './lib.mjs';

const jsonMode = process.argv.includes('--json');
const logsMode = process.argv.includes('--logs');
const prIndex = process.argv.findIndex((arg) => /^\d+$/.test(arg));
const requestedPr = prIndex >= 0 ? Number(process.argv[prIndex]) : null;

function normalizeChecks(rollup) {
  return (rollup ?? []).map((check) => ({
    name: check.name ?? check.context ?? 'unknown',
    status: check.status ?? check.state ?? 'unknown',
    conclusion: check.conclusion ?? check.state ?? null,
    url: check.detailsUrl ?? check.targetUrl ?? null,
    workflow: check.workflowName ?? null,
  }));
}

let pr = null;
if (requestedPr) {
  const result = gh([
    'pr',
    'view',
    String(requestedPr),
    '--json',
    'number,title,url,headRefName,headRefOid,statusCheckRollup',
  ]);
  if (result.ok) {
    try {
      pr = JSON.parse(result.stdout);
    } catch {
      pr = null;
    }
  }
} else {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
  const list = gh([
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number,title,url,headRefName,headRefOid,statusCheckRollup',
  ]);
  if (list.ok) {
    try {
      pr = JSON.parse(list.stdout)[0] ?? null;
    } catch {
      pr = null;
    }
  }
}

if (!pr) {
  const result = {
    ok: true,
    pr: null,
    message: 'No open pull request found for this branch.',
  };
  if (jsonMode) emitJson(result);
  else process.stdout.write(`${result.message}\n`);
} else {
  const checks = normalizeChecks(pr.statusCheckRollup);
  const failedConclusions = new Set([
    'FAILURE',
    'CANCELLED',
    'TIMED_OUT',
    'ACTION_REQUIRED',
    'STARTUP_FAILURE',
    'STALE',
  ]);
  const failing = checks.filter((check) => failedConclusions.has(check.conclusion));
  const pending = checks.filter((check) => !check.conclusion);
  const logs = [];

  if (logsMode && failing.length > 0 && pr.headRefOid) {
    const runs = gh([
      'run',
      'list',
      '--commit',
      pr.headRefOid,
      '--limit',
      '20',
      '--json',
      'databaseId,workflowName,conclusion,status',
    ]);
    if (runs.ok) {
      try {
        const failedRuns = JSON.parse(runs.stdout).filter((run) =>
          failedConclusions.has(run.conclusion),
        );
        for (const run of failedRuns.slice(0, 2)) {
          const view = gh(['run', 'view', String(run.databaseId), '--log-failed'], {
            timeout: 60_000,
          });
          if (!view.ok) continue;
          logs.push({
            runId: run.databaseId,
            workflow: run.workflowName,
            excerpt: view.stdout.split(/\r?\n/).slice(-80).join('\n'),
          });
        }
      } catch {
        // Logs are best-effort; checks remain the primary evidence.
      }
    }
  }

  const result = {
    ok: failing.length === 0,
    pr: {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      branch: pr.headRefName,
      sha: pr.headRefOid,
    },
    checks: {
      total: checks.length,
      failing: failing.length,
      pending: pending.length,
    },
    failing,
    pending,
    logs,
  };

  if (jsonMode) {
    emitJson(result);
  } else {
    process.stdout.write(`PR #${pr.number}: ${pr.title}\n`);
    process.stdout.write(`${pr.url}\n`);
    process.stdout.write(
      `checks: ${checks.length} total, ${failing.length} failing, ${pending.length} pending\n`,
    );
    if (checks.length) {
      printTable([
        ['check', 'status', 'conclusion', 'url'],
        ...checks.map((check) => [
          check.name,
          check.status,
          check.conclusion ?? 'pending',
          check.url ?? '-',
        ]),
      ]);
    }
    for (const entry of logs) {
      process.stdout.write(`\n== ${entry.workflow} (#${entry.runId}) failed log ==\n`);
      process.stdout.write(`${entry.excerpt}\n`);
    }
  }
}
