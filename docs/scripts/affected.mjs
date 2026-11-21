import {
  changedFiles,
  emitJson,
  git,
  isRootConfig,
  packageForFile,
  printTable,
  resolveBase,
} from './lib.mjs';

const usage = `Usage: node docs/scripts/affected.mjs [--base origin/dev] [--json]`;
const jsonMode = process.argv.includes('--json');
const baseIndex = process.argv.indexOf('--base');
const base = resolveBase(baseIndex >= 0 ? process.argv[baseIndex + 1] : 'origin/dev');
const files = changedFiles(base);

const packages = new Set();
let rootChanged = false;
let docsChanged = false;
let scriptsChanged = false;
for (const file of files) {
  const pkg = packageForFile(file);
  if (pkg) packages.add(pkg);
  else if (isRootConfig(file)) rootChanged = true;
  else if (file.startsWith('docs/scripts/')) scriptsChanged = true;
  else if (file === 'AGENTS.md' || file.startsWith('docs/')) docsChanged = true;
}
if (rootChanged) {
  packages.add('@rose/apiRose');
  packages.add('@rose/webRose');
  packages.add('@rose/mobileRose');
}

const packageCommands = [];
for (const pkg of packages) {
  packageCommands.push({
    package: pkg,
    test: `pnpm --filter ${pkg} test`,
    lint: `pnpm --filter ${pkg} lint`,
    types: `pnpm --filter ${pkg} check-types`,
  });
}

const commands = [];
if (rootChanged) commands.push('pnpm verify');
else if (scriptsChanged) commands.push('pnpm verify');
else {
  for (const entry of packageCommands) commands.push(entry.test);
  if (docsChanged) commands.push('node docs/scripts/docs-check.mjs');
}
if (commands.length === 0) commands.push('pnpm verify');

const result = {
  ok: true,
  base,
  changed: files.length,
  packages: [...packages],
  rootChanged,
  docsChanged,
  scriptsChanged,
  files,
  packageCommands,
  commands,
};

if (jsonMode) {
  emitJson(result);
} else if (files.length === 0) {
  process.stdout.write(`No changes vs ${base}.\n`);
} else {
  process.stdout.write(`${files.length} changed path(s) vs ${base}\n`);
  if (packages.size) {
    printTable([
      ['package', 'test'],
      ...packageCommands.map((entry) => [entry.package, entry.test]),
    ]);
  }
  if (rootChanged) process.stdout.write('root configuration changed: run pnpm verify\n');
  if (docsChanged && !rootChanged && !scriptsChanged) {
    process.stdout.write('docs changed: node docs/scripts/docs-check.mjs\n');
  }
  process.stdout.write('suggested:\n');
  for (const command of commands) process.stdout.write(`  ${command}\n`);
}

if (!git(['rev-parse', '--verify', base]).ok) {
  process.stderr.write(`warning: base ${base} does not resolve\n`);
}
