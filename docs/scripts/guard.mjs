import path from 'node:path';
import {
  emitJson,
  fileSize,
  git,
  isForbiddenLockfile,
  isTestFile,
  markdownPlacementIssue,
  readText,
  resolveBase,
  testPlacementIssue,
} from './lib.mjs';

const jsonMode = process.argv.includes('--json');
const stagedMode = process.argv.includes('--staged');
const diffMode = process.argv.includes('--diff') || !stagedMode;
const baseIndex = process.argv.indexOf('--base');
const base = resolveBase(baseIndex >= 0 ? process.argv[baseIndex + 1] : 'origin/dev');

const generatedPattern =
  /(^|\/)(node_modules|\.next|\.expo|\.dev|\.atl|\.turbo|dist|bin|coverage)\/|\.tsbuildinfo$|^mobileRose\/expo-env\.d\.ts$/;
const envPattern = /(^|\/)\.env(\.|$)/;
const secretPatterns = [
  { name: 'private-key', pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'slack-token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
];
const largeFileBytes = 1024 * 1024;

function statusEntries(output) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      return { status: parts[0], path: parts[parts.length - 1] };
    });
}

function collect() {
  const entries = new Map();
  const add = (entry) => {
    if (entry.path) entries.set(entry.path, entry);
  };
  if (stagedMode) {
    const status = git(['diff', '--cached', '--name-status']);
    if (status.ok) statusEntries(status.stdout).forEach(add);
    return { entries: [...entries.values()], diffArgs: ['diff', '--cached', '-U0'], untracked: [] };
  }
  for (const args of [
    ['diff', '--name-status', base],
    ['diff', '--name-status', `${base}...HEAD`],
  ]) {
    const result = git(args);
    if (result.ok) statusEntries(result.stdout).forEach(add);
  }
  const untrackedResult = git(['ls-files', '--others', '--exclude-standard']);
  const untracked = untrackedResult.ok ? untrackedResult.stdout.split(/\r?\n/).filter(Boolean) : [];
  for (const file of untracked) add({ status: 'A', path: file });
  return {
    entries: [...entries.values()],
    diffArgs: ['diff', base, '-U0'],
    diffArgsCommitted: ['diff', `${base}...HEAD`, '-U0'],
    untracked,
  };
}

const collected = collect();
const addedLines = new Map();
const appendLine = (file, line) => {
  if (!addedLines.has(file)) addedLines.set(file, []);
  addedLines.get(file).push(line);
};

for (const args of [collected.diffArgs, collected.diffArgsCommitted ?? []]) {
  if (!args) continue;
  const diff = git(args);
  if (!diff.ok) continue;
  let file = null;
  for (const line of diff.stdout.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      file = line.slice('+++ b/'.length);
    } else if (file && line.startsWith('+') && !line.startsWith('+++')) {
      appendLine(file, line.slice(1));
    }
  }
}

for (const file of collected.untracked) {
  const text = readText(file);
  if (text) for (const line of text.split(/\r?\n/)) appendLine(file, line);
}

const issues = [];
for (const entry of collected.entries) {
  const file = entry.path;
  if (entry.status.startsWith('D')) continue;
  const placement = markdownPlacementIssue(file);
  if (placement) {
    issues.push({ type: 'markdown-placement', path: file, detail: placement });
  }
  if (isForbiddenLockfile(file)) {
    issues.push({ type: 'lockfile', path: file, detail: 'only pnpm-lock.yaml is allowed' });
  }
  const testIssue = testPlacementIssue(file);
  if (testIssue) {
    issues.push({ type: 'test-placement', path: file, detail: testIssue });
  }
  if (generatedPattern.test(file) && !isTestFile(file)) {
    issues.push({ type: 'generated', path: file, detail: 'generated path must not be committed' });
  }
  if (envPattern.test(path.basename(file)) && !file.endsWith('.env.example')) {
    issues.push({ type: 'env', path: file, detail: 'environment file must not be committed' });
  }
  if (
    (entry.status.startsWith('A') || collected.untracked.includes(file)) &&
    fileSize(file) > largeFileBytes
  ) {
    issues.push({
      type: 'large-file',
      path: file,
      detail: `new file is ${(fileSize(file) / 1024 / 1024).toFixed(1)} MB`,
    });
  }
  for (const [lineNumber, line] of (addedLines.get(file) ?? []).entries()) {
    if (file.startsWith('docs/scripts/')) continue;
    for (const secret of secretPatterns) {
      if (secret.pattern.test(line)) {
        issues.push({
          type: 'secret',
          path: file,
          line: lineNumber + 1,
          detail: `possible ${secret.name}`,
        });
      }
    }
  }
}

const result = { ok: issues.length === 0, mode: stagedMode ? 'staged' : 'diff', base, issues };
if (jsonMode) {
  emitJson(result);
} else if (issues.length === 0) {
  process.stdout.write(`guard: clean (${collected.entries.length} path(s), ${result.mode})\n`);
} else {
  process.stdout.write(`guard: ${issues.length} issue(s)\n`);
  for (const issue of issues) {
    process.stdout.write(
      `  ${issue.type.padEnd(11)} ${issue.path}${issue.line ? `:${issue.line}` : ''} — ${issue.detail}\n`,
    );
  }
}
process.exitCode = issues.length === 0 ? 0 : 1;
