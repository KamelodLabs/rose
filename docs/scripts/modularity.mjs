/**
 * Modularity boundary checker.
 *
 * This is intentionally a small static scanner, not a resolver or type checker.
 * It reads import specifiers from static imports, re-exports, side-effect imports,
 * dynamic imports, and require calls, plus Go import declarations under
 * apiRose/internal/platform, then applies the rules from
 * docs/monorepo/09-modularization.md.
 *
 * The parser is deliberately simple: it does not evaluate code, follow aliases, or
 * resolve package exports. TypeScript, ESLint, and the frameworks resolve the rest.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { emitJson, parseCli, root } from './lib.mjs';

const usage = `Usage: node docs/scripts/modularity.mjs [--json]

Checks app-local module boundaries in webRose and mobileRose, plus the Go platform direction:
  - no package.json or packages/ directory inside an app src
  - direct child directories of an app src are limited to app, features, shared, __tests__, e2e
  - every feature that contains code exposes index.ts or index.tsx
  - shared does not import features/app; features do not import features/app
  - app imports features only through the public index
  - relative imports stay inside their module and app
  - apiRose/internal/platform does not import internal domain packages

Exit code 0 when clean, 1 when violations exist. Use --json for machine-readable output.`;

const parsed = parseCli(usage);

const APPS = ['webRose', 'mobileRose'];
const ALLOWED_SRC_AREAS = new Set(['app', 'features', 'shared', '__tests__', 'e2e']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const GO_PLATFORM_DIRECTORY = path.join(root, 'apiRose', 'internal', 'platform');
const GO_INTERNAL_PREFIX = 'rose/apiRose/internal/';
const GO_PLATFORM_PREFIX = 'rose/apiRose/internal/platform';
const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  '.expo',
  '.turbo',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
]);

const FROM_PATTERN = /\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_PATTERN = /^\s*import\s+['"]([^'"]+)['"]/gm;
const DYNAMIC_PATTERN = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_PATTERN = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const violations = [];
const seenViolations = new Set();
const sourceFiles = [];
const goFiles = [];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function displayPath(absolute) {
  return toPosix(path.relative(root, absolute));
}

function isFile(absolute) {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function isDirectory(absolute) {
  try {
    return statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

function addViolation(file, line, rule, message) {
  const normalized = displayPath(file);
  const key = `${normalized}|${line}|${rule}|${message}`;
  if (seenViolations.has(key)) return;
  seenViolations.add(key);
  violations.push({ file: normalized, line, rule, message });
}

function walk(directory, { onFile, onDirectory, skipNames = IGNORED_DIRS } = {}) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && skipNames.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      onDirectory?.(absolute);
      walk(absolute, { onFile, onDirectory, skipNames });
    } else if (entry.isFile()) {
      onFile?.(absolute);
    }
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveTarget(base) {
  if (isFile(base)) return base;
  for (const extension of CODE_EXTENSIONS) {
    if (isFile(`${base}${extension}`)) return `${base}${extension}`;
  }
  for (const extension of CODE_EXTENSIONS) {
    const index = path.join(base, `index${extension}`);
    if (isFile(index)) return index;
  }
  return null;
}

function lineAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function stripGoComments(text) {
  let result = '';
  let inBlockComment = false;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
        result += '  ';
      } else {
        result += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (quote) {
      result += character;
      if (quote !== '`' && character === '\\' && next !== undefined) {
        result += next;
        index += 1;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      result += character;
      continue;
    }
    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      result += '  ';
      continue;
    }
    if (character === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      if (index < text.length) result += '\n';
      continue;
    }
    result += character;
  }
  return result;
}

function goImportPaths(line) {
  const paths = [];
  const pattern = /(["`])([^"`]+)\1/g;
  let match;
  while ((match = pattern.exec(line)) !== null) paths.push(match[2]);
  return paths;
}

function collectGoImports(text) {
  const lines = stripGoComments(text).split(/\r?\n/);
  const imports = [];
  let inBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    if (inBlock) {
      const close = line.indexOf(')');
      const content = close >= 0 ? line.slice(0, close) : line;
      for (const importPath of goImportPaths(content))
        imports.push({ line: lineNumber, path: importPath });
      if (close >= 0) inBlock = false;
      continue;
    }
    const open = line.match(/^\s*import\s*\(/);
    if (open) {
      const rest = line.slice(open[0].length);
      const close = rest.indexOf(')');
      const content = close >= 0 ? rest.slice(0, close) : rest;
      for (const importPath of goImportPaths(content))
        imports.push({ line: lineNumber, path: importPath });
      inBlock = close < 0;
      continue;
    }
    const single = line.match(/^\s*import\b(.*)$/);
    if (single) {
      for (const importPath of goImportPaths(single[1]))
        imports.push({ line: lineNumber, path: importPath });
    }
  }
  return imports;
}

function collectSpecifiers(text) {
  const found = new Map();
  for (const pattern of [FROM_PATTERN, SIDE_EFFECT_PATTERN, DYNAMIC_PATTERN, REQUIRE_PATTERN]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const key = `${lineAt(text, match.index)}|${match[1]}`;
      if (!found.has(key)) found.set(key, { line: lineAt(text, match.index), specifier: match[1] });
    }
  }
  return [...found.values()];
}

function featureName(srcDirectory, absolute) {
  if (!isInside(srcDirectory, absolute)) return null;
  const relative = toPosix(path.relative(srcDirectory, absolute));
  const parts = relative.split('/');
  if (parts[0] !== 'features' || parts.length < 2) return null;
  return parts[1];
}

function containsCode(directory) {
  let found = false;
  walk(directory, {
    onFile(absolute) {
      if (CODE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) found = true;
    },
  });
  return found;
}

function checkAliasImport(context, target) {
  const { srcDirectory, area, fileFeature } = context;
  const isFeatures = target === 'features' || target.startsWith('features/');
  const isApp = target === 'app' || target.startsWith('app/');
  const parts = target.split('/');

  if (area === 'shared' && (isFeatures || isApp)) {
    addViolation(
      context.file,
      context.line,
      'shared-imports-up',
      'shared code must not import features or app code',
    );
    return;
  }

  if (area === 'features' && isApp) {
    addViolation(
      context.file,
      context.line,
      'feature-imports-app',
      'features must not import app code',
    );
    return;
  }

  if (area === 'features' && isFeatures) {
    addViolation(
      context.file,
      context.line,
      'feature-imports-feature',
      `features must not import features (${fileFeature}); use relative imports inside the same feature`,
    );
    return;
  }

  if (area === 'app' && isFeatures && parts.length > 2) {
    addViolation(
      context.file,
      context.line,
      'app-deep-feature-import',
      'import a feature through its public index only (@/features/<name>)',
    );
    return;
  }

  if (area === 'app' && target === 'features') {
    addViolation(
      context.file,
      context.line,
      'app-deep-feature-import',
      'import a feature through its public index only (@/features/<name>)',
    );
  }
}

function checkRelativeImport(context, specifier) {
  const { srcDirectory, appDirectory, area, fileFeature, file, line } = context;
  const base = path.resolve(path.dirname(file), specifier);

  if (!isInside(appDirectory, base)) {
    addViolation(
      file,
      line,
      'relative-escapes-app',
      'relative import must stay inside the app; cross-app imports are forbidden',
    );
    return;
  }

  if (area === 'shared') {
    const sharedDirectory = path.join(srcDirectory, 'shared');
    if (!isInside(sharedDirectory, base)) {
      addViolation(
        file,
        line,
        'shared-relative-escapes',
        'relative import from shared must stay inside src/shared',
      );
    }
    return;
  }

  if (area === 'features') {
    const featureDirectory = path.join(srcDirectory, 'features', fileFeature);
    if (!isInside(featureDirectory, base)) {
      addViolation(
        file,
        line,
        'feature-relative-escapes',
        'relative import must stay inside this feature; use @/shared/* for shared code',
      );
    }
    return;
  }

  if (area === 'app') {
    const targetFeature = featureName(srcDirectory, base);
    if (!targetFeature) return;
    const indexTs = path.join(srcDirectory, 'features', targetFeature, 'index.ts');
    const indexTsx = path.join(srcDirectory, 'features', targetFeature, 'index.tsx');
    const resolved = resolveTarget(base);
    if (!resolved || (resolved !== indexTs && resolved !== indexTsx)) {
      addViolation(
        file,
        line,
        'app-deep-feature-import',
        'a relative import into a feature must resolve to its index.ts or index.tsx',
      );
    }
  }
}

function checkImport(context, specifier) {
  if (specifier.startsWith('@/')) {
    checkAliasImport(context, specifier.slice(2));
    return;
  }
  if (specifier.startsWith('.')) {
    checkRelativeImport(context, specifier);
  }
}

function checkSourceFile(app, srcDirectory, file) {
  const relative = toPosix(path.relative(srcDirectory, file));
  const parts = relative.split('/');
  const context = {
    app,
    srcDirectory,
    appDirectory: path.join(root, app),
    file,
    area: parts[0],
    fileFeature: parts[0] === 'features' ? parts[1] : null,
    line: 0,
  };

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  sourceFiles.push(file);
  for (const entry of collectSpecifiers(text)) {
    context.line = entry.line;
    checkImport(context, entry.specifier);
  }
}

for (const app of APPS) {
  const appDirectory = path.join(root, app);
  const srcDirectory = path.join(appDirectory, 'src');
  if (!isDirectory(srcDirectory)) continue;

  for (const entry of readdirSync(srcDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
    if (ALLOWED_SRC_AREAS.has(entry.name)) continue;
    addViolation(
      path.join(srcDirectory, entry.name),
      1,
      'unexpected-src-area',
      `unexpected src area "${entry.name}"; allowed: ${[...ALLOWED_SRC_AREAS].join(', ')}`,
    );
  }

  for (const area of ['features', 'shared']) {
    const areaDirectory = path.join(srcDirectory, area);
    walk(areaDirectory, {
      onFile(absolute) {
        if (path.basename(absolute) === 'package.json') {
          addViolation(
            absolute,
            1,
            'no-module-package-json',
            'app-local modules are not packages; remove package.json',
          );
        }
      },
    });
  }

  walk(srcDirectory, {
    onDirectory(absolute) {
      if (path.basename(absolute) === 'packages') {
        addViolation(
          absolute,
          1,
          'no-packages-directory',
          'an app src must not contain a packages directory; modules are not packages',
        );
      }
    },
    onFile(absolute) {
      if (CODE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
        checkSourceFile(app, srcDirectory, absolute);
      }
    },
  });

  const featuresDirectory = path.join(srcDirectory, 'features');
  if (isDirectory(featuresDirectory)) {
    for (const entry of readdirSync(featuresDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
      const featureDirectory = path.join(featuresDirectory, entry.name);
      if (!containsCode(featureDirectory)) continue;
      const hasIndex =
        isFile(path.join(featureDirectory, 'index.ts')) ||
        isFile(path.join(featureDirectory, 'index.tsx'));
      if (!hasIndex) {
        addViolation(
          path.join(featureDirectory, 'index.ts'),
          1,
          'feature-index',
          'a feature folder that contains code must expose index.ts or index.tsx',
        );
      }
    }
  }
}

if (isDirectory(GO_PLATFORM_DIRECTORY)) {
  walk(GO_PLATFORM_DIRECTORY, {
    onFile(absolute) {
      if (path.extname(absolute).toLowerCase() !== '.go') return;
      let text;
      try {
        text = readFileSync(absolute, 'utf8');
      } catch {
        return;
      }
      goFiles.push(absolute);
      for (const entry of collectGoImports(text)) {
        if (!entry.path.startsWith(GO_INTERNAL_PREFIX)) continue;
        if (entry.path === GO_PLATFORM_PREFIX) continue;
        if (entry.path.startsWith(`${GO_PLATFORM_PREFIX}/`)) continue;
        addViolation(
          absolute,
          entry.line,
          'platform-imports-domain',
          `platform must not import internal domain package "${entry.path}"`,
        );
      }
    },
  });
}

violations.sort((left, right) => {
  const byFile = left.file.localeCompare(right.file);
  if (byFile !== 0) return byFile;
  if (left.line !== right.line) return left.line - right.line;
  const byRule = left.rule.localeCompare(right.rule);
  if (byRule !== 0) return byRule;
  return left.message.localeCompare(right.message);
});

const result = { ok: violations.length === 0, violations };
if (parsed.flags.json) {
  emitJson(result);
} else if (result.ok) {
  process.stdout.write(
    `modularity: clean (${sourceFiles.length} source file(s) in ${APPS.length} app(s), ${goFiles.length} Go platform file(s))\n`,
  );
} else {
  process.stdout.write(`modularity: ${violations.length} violation(s)\n`);
  for (const violation of violations) {
    process.stdout.write(
      `  ${violation.file}:${violation.line} ${violation.rule} — ${violation.message}\n`,
    );
  }
}
process.exitCode = result.ok ? 0 : 1;
