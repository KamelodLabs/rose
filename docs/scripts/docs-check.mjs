import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  emitJson,
  git,
  isForbiddenLockfile,
  isMarkdown,
  markdownPlacementIssue,
  parseArgs,
  readJson,
  readText,
  root,
  testPlacementIssue,
} from './lib.mjs';

const usage = `Usage: node docs/scripts/docs-check.mjs [--json]

Checks Markdown placement and links, the docs index, the single root AGENTS.md, the lockfile policy,
test placement, and the docs/scripts registry.`;

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2), { flags: ['help', 'json'] });
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage}\n`);
  process.exit(1);
}
if (parsed.flags.help) {
  process.stdout.write(`${usage}\n`);
  process.exit();
}

const issues = [];
const add = (type, file, detail, line = 1) => issues.push({ type, file, line, detail });
const lines = (value) => value.split(/\r?\n/).filter(Boolean);

const tracked = git(['ls-files']);
const untracked = git(['ls-files', '--others', '--exclude-standard']);
const allFiles = [...new Set([...lines(tracked.stdout), ...lines(untracked.stdout)])];
const markdownFiles = allFiles.filter(isMarkdown);

for (const file of allFiles) {
  const placement = markdownPlacementIssue(file);
  if (placement) add('markdown-placement', file, placement);
  if (isForbiddenLockfile(file)) add('lockfile', file, 'only pnpm-lock.yaml is allowed');
  const testIssue = testPlacementIssue(file);
  if (testIssue) add('test-placement', file, testIssue);
}

const agents = allFiles.filter((file) => /(^|\/)AGENTS\.md$/.test(file));
if (!agents.includes('AGENTS.md')) add('agents-missing', 'AGENTS.md', 'root AGENTS.md is required');
if (agents.length > 1) {
  add('agents-count', 'AGENTS.md', `found ${agents.length} AGENTS.md files; keep one at the root`);
}
const agentsText = readText('AGENTS.md');
if (agentsText) {
  const agentsLines = agentsText.split(/\r?\n/);
  if (agentsLines.length > 150) {
    add('agents-size', 'AGENTS.md', `${agentsLines.length} lines; keep it under 150`);
  }
  for (const heading of ['## Commands', '## Boundaries', '## Working style']) {
    if (!agentsText.includes(heading)) add('agents-section', 'AGENTS.md', `missing ${heading}`);
  }
}

const docsDir = path.join(root, 'docs', 'monorepo');
const indexPath = path.join(docsDir, 'README.md');
const indexText = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
if (!indexText) {
  add('docs-index', 'docs/monorepo/README.md', 'missing docs index');
} else {
  for (const entry of readdirSync(docsDir)) {
    if (!entry.endsWith('.md') || entry === 'README.md') continue;
    if (!indexText.includes(entry)) {
      add('docs-index', `docs/monorepo/${entry}`, 'not linked from docs/monorepo/README.md');
    }
  }
}

const packageJson = readJson('package.json');
const scripts = Object.values(packageJson?.scripts ?? {}).filter(
  (value) => typeof value === 'string',
);
const scriptText = scripts.join('\n');
const scriptsDir = path.join(root, 'docs', 'scripts');
const internalScripts = new Set(['lib.mjs', 'run-service.mjs']);
const scriptsReadme = readText('docs/scripts/README.md') ?? '';
if (existsSync(scriptsDir)) {
  for (const entry of readdirSync(scriptsDir)) {
    if (!entry.endsWith('.mjs') || internalScripts.has(entry)) continue;
    if (!scriptText.includes(`docs/scripts/${entry}`) && !scriptsReadme.includes(entry)) {
      add(
        'script-registry',
        `docs/scripts/${entry}`,
        'not referenced by package.json or docs/scripts/README.md',
      );
    }
  }
}
for (const script of scripts) {
  for (const match of script.matchAll(/node\s+docs\/scripts\/([\w.-]+\.mjs)/g)) {
    if (!existsSync(path.join(scriptsDir, match[1]))) {
      add('script-target', `docs/scripts/${match[1]}`, 'referenced in package.json but missing');
    }
  }
}

const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  const content = readFileSync(path.join(root, file), 'utf8');
  const fileLines = content.split(/\r?\n/);
  let inFence = false;
  for (let index = 0; index < fileLines.length; index += 1) {
    const line = fileLines[index];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let match;
    while ((match = linkPattern.exec(line)) !== null) {
      let target = match[1].trim();
      if (
        !target ||
        target.startsWith('#') ||
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('mailto:') ||
        target.startsWith('/') ||
        target.startsWith('<')
      ) {
        continue;
      }
      target = target.split('#')[0];
      if (!target) continue;
      const resolved = path.resolve(path.dirname(path.join(root, file)), target);
      if (!existsSync(resolved)) {
        add('broken-link', relative, `missing ${target}`, index + 1);
      }
    }
  }
}

const result = { ok: issues.length === 0, files: markdownFiles.length, issues };
if (parsed.flags.json) {
  emitJson(result);
} else if (issues.length === 0) {
  process.stdout.write(`docs: clean (${markdownFiles.length} markdown file(s))\n`);
} else {
  process.stdout.write(`docs: ${issues.length} issue(s)\n`);
  for (const issue of issues) {
    process.stdout.write(`  ${issue.file}:${issue.line} ${issue.type} — ${issue.detail}\n`);
  }
}
process.exitCode = issues.length === 0 ? 0 : 1;
