import path from 'node:path';
import {
  changedFiles,
  emitJson,
  git,
  isRootConfig,
  isTestFile,
  packageForFile,
  readJson,
  resolveBase,
  run,
  scriptsDir,
} from './lib.mjs';

const jsonMode = process.argv.includes('--json');
const baseIndex = process.argv.indexOf('--base');
const base = resolveBase(baseIndex >= 0 ? process.argv[baseIndex + 1] : 'origin/dev');
const files = changedFiles(base);

const groups = { api: [], web: [], mobile: [], root: [], docs: [], other: [] };
for (const file of files) {
  const pkg = packageForFile(file);
  if (pkg === '@rose/apiRose') groups.api.push(file);
  else if (pkg === '@rose/webRose') groups.web.push(file);
  else if (pkg === '@rose/mobileRose') groups.mobile.push(file);
  else if (isRootConfig(file)) groups.root.push(file);
  else if (file === 'AGENTS.md' || file.startsWith('docs/')) groups.docs.push(file);
  else groups.other.push(file);
}

const guard = run(
  process.execPath,
  [path.join(scriptsDir, 'guard.mjs'), '--diff', '--base', base, '--json'],
  { timeout: 120_000 },
);
let guardResult = null;
try {
  guardResult = JSON.parse(guard.stdout);
} catch {
  guardResult = { ok: false, issues: [], error: guard.stderr || 'guard produced no JSON' };
}
const issues = guardResult?.issues ?? [];
const testsTouched = files.filter(isTestFile);

const packages = new Set();
if (groups.api.length) packages.add('@rose/apiRose');
if (groups.web.length) packages.add('@rose/webRose');
if (groups.mobile.length) packages.add('@rose/mobileRose');
if (groups.root.length) {
  packages.add('@rose/apiRose');
  packages.add('@rose/webRose');
  packages.add('@rose/mobileRose');
}

const commands = [];
if (groups.root.length) commands.push('pnpm verify');
else {
  for (const pkg of packages) commands.push(`pnpm --filter ${pkg} test`);
  if (groups.docs.length) commands.push('node docs/scripts/docs-check.mjs');
}
if (commands.length === 0) commands.push('pnpm verify');

const result = {
  ok: issues.length === 0,
  base,
  files: {
    total: files.length,
    tests: testsTouched,
    groups,
  },
  diffStat: {
    working: git(['diff', '--stat', base]).stdout,
    committed: git(['diff', '--stat', `${base}...HEAD`]).stdout,
  },
  guard: guardResult,
  issues,
  commands,
};

if (jsonMode) {
  emitJson(result);
} else {
  process.stdout.write(`review: ${files.length} changed path(s) vs ${base}\n`);
  for (const [name, entries] of Object.entries(groups)) {
    if (entries.length) process.stdout.write(`  ${name.padEnd(6)} ${entries.length}\n`);
  }
  if (testsTouched.length) {
    process.stdout.write(`tests: ${testsTouched.join(', ')}\n`);
  }
  if (issues.length) {
    process.stdout.write(`guard: ${issues.length} issue(s)\n`);
    for (const issue of issues) {
      process.stdout.write(
        `  ${issue.type.padEnd(11)} ${issue.path}${issue.line ? `:${issue.line}` : ''} — ${issue.detail}\n`,
      );
    }
  } else {
    process.stdout.write('guard: clean\n');
  }
  process.stdout.write('suggested commands:\n');
  for (const command of commands) process.stdout.write(`  ${command}\n`);
}
