import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { emitJson, parseArgs, root } from './lib.mjs';

const usage = `Usage: node docs/scripts/docs-check.mjs [--json]

Checks relative Markdown links under docs/ and AGENTS.md, and keeps AGENTS.md within 150 lines.`;

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

function walk(directory) {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith('.md')) results.push(absolute);
  }
  return results;
}

const files = [
  ...(existsSync(path.join(root, 'AGENTS.md')) ? [path.join(root, 'AGENTS.md')] : []),
  ...(existsSync(path.join(root, 'docs')) ? walk(path.join(root, 'docs')) : []),
];

const issues = [];
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

for (const file of files) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
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
      const resolved = path.resolve(path.dirname(file), target);
      if (!existsSync(resolved)) {
        issues.push({
          severity: 'error',
          type: 'broken-link',
          file: relative,
          line: index + 1,
          detail: `missing ${target}`,
        });
      }
    }
  }

  if (relative === 'AGENTS.md') {
    if (lines.length > 150) {
      issues.push({
        severity: 'error',
        type: 'agents-size',
        file: relative,
        line: 1,
        detail: `${lines.length} lines; keep it under 150`,
      });
    }
    const text = lines.join('\n');
    for (const heading of ['## Commands', '## Boundaries', '## Working style']) {
      if (!text.includes(heading)) {
        issues.push({
          severity: 'error',
          type: 'agents-section',
          file: relative,
          line: 1,
          detail: `missing ${heading}`,
        });
      }
    }
  }
}

const result = { ok: issues.length === 0, files: files.length, issues };
if (parsed.flags.json) {
  emitJson(result);
} else if (issues.length === 0) {
  process.stdout.write(`docs: clean (${files.length} markdown file(s))\n`);
} else {
  process.stdout.write(`docs: ${issues.length} issue(s)\n`);
  for (const issue of issues) {
    process.stdout.write(`  ${issue.file}:${issue.line} ${issue.type} — ${issue.detail}\n`);
  }
}
process.exitCode = issues.length === 0 ? 0 : 1;
