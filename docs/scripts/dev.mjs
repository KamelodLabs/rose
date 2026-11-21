import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stateDir = path.join(root, '.dev');
const logDir = path.join(stateDir, 'logs');
const registryPath = path.join(stateDir, 'services.json');
const mobileMetadataPath = path.join(root, 'mobileRose', '.expo', 'rose-dev.json');
const mobileMetadataRel = 'mobileRose/.expo/rose-dev.json';
const serviceNames = ['api', 'web', 'mobile'];

const usage = `Usage: node docs/scripts/dev.mjs <start|status|stop|logs> [service] [--json] [--lines N]

Commands:
  start    Start api, web, and mobile detached, then wait until each is ready
  status   Probe registered services and refresh their statuses
  stop     Kill registered service process trees
  logs     Print the last N lines of a service log (api, web, or mobile)

Options:
  --json       Print only JSON to stdout
  --lines N    Number of lines for logs (default 40)
  --help       Show this help

Services:
  api      pnpm --filter @rose/apiRose dev (PORT, /health)
  web      pnpm --filter @rose/webRose exec next dev -p <port>
  mobile   pnpm --filter @rose/mobileRose start (Expo Go metadata)

State: .dev/services.json, logs: .dev/logs/<service>.out.log and .err.log`;

class UsageError extends Error {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInt(value, flag) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new UsageError(`${flag} needs a positive integer`);
  return parsed;
}

function parseArgs(argv) {
  const flags = { json: false, lines: 40, help: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--lines') {
      index += 1;
      flags.lines = positiveInt(argv[index], '--lines');
    } else if (arg.startsWith('--lines=')) {
      flags.lines = positiveInt(arg.slice('--lines='.length), '--lines');
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0] ?? null, service: positionals[1] ?? null, flags };
}

function logPaths(name) {
  return { out: `.dev/logs/${name}.out.log`, err: `.dev/logs/${name}.err.log` };
}

function readRegistry() {
  try {
    return JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeRegistry(registry) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

function readMobileMetadata() {
  try {
    return JSON.parse(readFileSync(mobileMetadataPath, 'utf8'));
  } catch {
    return null;
  }
}

function markMobileMetadataStopped() {
  const metadata = readMobileMetadata();
  if (!metadata) return;
  const updated = { ...metadata, status: 'stopped', updatedAt: new Date().toISOString() };
  try {
    writeFileSync(mobileMetadataPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  } catch {
    // Metadata is best-effort state; stopping services must not fail because of it.
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port }, () => server.close(() => resolve(true)));
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 200; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`no free TCP port found from ${start} to ${start + 199}`);
}

async function probeHttp(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2500) });
    return { status: response.status };
  } catch {
    return { status: 0 };
  }
}

function spawnDetached(name, commandLine, env) {
  const outPath = path.join(logDir, `${name}.out.log`);
  const errPath = path.join(logDir, `${name}.err.log`);
  const runner = path.join(root, 'docs', 'scripts', 'run-service.mjs');
  const child = spawn(process.execPath, [runner, outPath, errPath, commandLine], {
    cwd: root,
    env,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    shell: false,
  });
  child.on('error', () => {});
  child.unref();
  if (!child.pid) throw new Error(`failed to spawn ${name}`);
  return child.pid;
}

function killTree(pid) {
  if (!isAlive(pid)) return;
  try {
    if (process.platform === 'win32') {
      const command = `taskkill /PID ${pid} /T /F`;
      execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 15000,
      });
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
    }
  } catch {
    // The tree is already gone or could not be signalled; status is verified separately.
  }
}

async function waitUntil(pid, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let detail = 'waiting';
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return { ok: false, detail: 'process exited' };
    const result = await check();
    if (result.ok) return result;
    detail = result.detail;
    await sleep(500);
  }
  return { ok: false, detail: `timed out after ${Math.round(timeoutMs / 1000)}s (${detail})` };
}

function httpCheck(url, name) {
  return async () => {
    const probe = await probeHttp(url);
    if (probe.status === 0) return { ok: false, detail: 'no response' };
    if (name === 'api' && (probe.status < 200 || probe.status >= 300)) {
      return { ok: false, detail: `HTTP ${probe.status}` };
    }
    if (name === 'web' && probe.status >= 500) return { ok: false, detail: `HTTP ${probe.status}` };
    return { ok: true, status: probe.status };
  };
}

function mobileStatus(metadata) {
  if (!metadata) return 'missing';
  if (metadata.status !== 'ready') return metadata.status ?? 'unknown';
  if (!String(metadata.expoGoUrl ?? '').startsWith('exp://')) return 'invalid';
  if (!isAlive(metadata.pid)) return 'degraded';
  return 'ready';
}

async function serviceStatus(name, service) {
  if (!isAlive(service.pid)) return 'stopped';
  if (name === 'mobile')
    return mobileStatus(readMobileMetadata()) === 'ready' ? 'ready' : 'degraded';
  const probe = await probeHttp(service.health);
  if (name === 'api') {
    return probe.status >= 200 && probe.status < 300 ? 'ready' : 'degraded';
  }
  return probe.status > 0 && probe.status < 500 ? 'ready' : 'degraded';
}

async function refreshStatuses(registry) {
  if (!registry.services) registry.services = {};
  await Promise.all(
    serviceNames.map(async (name) => {
      const service = registry.services[name];
      if (!service) return;
      service.status = await serviceStatus(name, service);
    }),
  );
  return registry;
}

function renderTable(registry) {
  const header = ['service', 'status', 'pid', 'port', 'url'];
  const rows = serviceNames.flatMap((name) => {
    const service = registry.services?.[name];
    if (!service) return [];
    return [
      [
        name,
        service.status ?? 'unknown',
        service.pid == null ? '-' : String(service.pid),
        service.port == null ? '-' : String(service.port),
        service.url ?? '-',
      ],
    ];
  });
  const widths = header.map((_, column) =>
    Math.max(header[column].length, ...rows.map((row) => row[column].length)),
  );
  return [header, ...rows]
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function output(registry, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(registry, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderTable(registry)}\n`);
  const mobile = registry.services?.mobile;
  if (mobile?.url) process.stdout.write(`mobile: ${mobile.url}\n`);
  if (mobile?.qrPath) process.stdout.write(`qr: ${mobile.qrPath}\n`);
}

async function start(flags) {
  mkdirSync(logDir, { recursive: true });

  const existing = readRegistry();
  const anyLive = existing && serviceNames.some((name) => isAlive(existing.services?.[name]?.pid));
  if (anyLive) {
    await refreshStatuses(existing);
    writeRegistry(existing);
    output(existing, flags.json);
    return 0;
  }

  const apiPort = await findFreePort(8080);
  const webPort = await findFreePort(3000);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const baseEnv = {
    ...process.env,
    TURBO_TELEMETRY_DISABLED: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    EXPO_NO_TELEMETRY: '1',
  };
  const previousMobile = readMobileMetadata();

  const apiPid = spawnDetached('api', 'pnpm --filter @rose/apiRose dev', {
    ...baseEnv,
    PORT: String(apiPort),
  });
  const webPid = spawnDetached(
    'web',
    `pnpm --filter @rose/webRose exec next dev -p ${webPort}`,
    baseEnv,
  );
  const mobilePid = spawnDetached('mobile', 'pnpm --filter @rose/mobileRose start', baseEnv);

  const registry = {
    startedAt: new Date().toISOString(),
    services: {
      api: {
        pid: apiPid,
        port: apiPort,
        url: apiUrl,
        health: `${apiUrl}/health`,
        log: logPaths('api'),
        status: 'starting',
      },
      web: {
        pid: webPid,
        port: webPort,
        url: webUrl,
        health: `${webUrl}/`,
        log: logPaths('web'),
        status: 'starting',
      },
      mobile: {
        pid: mobilePid,
        port: null,
        url: null,
        qrPath: null,
        metadata: mobileMetadataRel,
        log: logPaths('mobile'),
        status: 'starting',
      },
    },
  };
  writeRegistry(registry);

  const apiCheck = httpCheck(registry.services.api.health, 'api');
  const webCheck = httpCheck(registry.services.web.health, 'web');
  const mobileCheck = () => {
    const metadata = readMobileMetadata();
    if (!metadata) return { ok: false, detail: 'metadata pending' };
    if (previousMobile?.startedAt && metadata.startedAt === previousMobile.startedAt) {
      return { ok: false, detail: 'metadata is stale' };
    }
    const status = mobileStatus(metadata);
    if (status === 'ready') return { ok: true, metadata };
    return { ok: false, detail: `metadata ${status}` };
  };

  const [apiResult, webResult, mobileResult] = await Promise.all([
    waitUntil(apiPid, apiCheck, 90_000),
    waitUntil(webPid, webCheck, 90_000),
    waitUntil(mobilePid, mobileCheck, 120_000),
  ]);

  const results = { api: apiResult, web: webResult, mobile: mobileResult };
  const failed = serviceNames.find((name) => !results[name].ok);

  if (failed) {
    for (const name of serviceNames) {
      const service = registry.services[name];
      killTree(service.pid);
      if (results[name].ok) {
        service.status = 'stopped';
      } else {
        service.status = 'failed';
        service.error = results[name].detail;
      }
    }
    registry.failedAt = new Date().toISOString();
    writeRegistry(registry);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(registry, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderTable(registry)}\n`);
    }
    process.stderr.write(`dev start failed: ${failed} (${results[failed].detail})\n`);
    return 1;
  }

  const metadata = mobileResult.metadata;
  registry.services.api.status = 'ready';
  registry.services.web.status = 'ready';
  registry.services.mobile.status = 'ready';
  registry.services.mobile.port = metadata.port ?? null;
  registry.services.mobile.url = metadata.expoGoUrl ?? null;
  registry.services.mobile.qrPath = metadata.qrPath ?? null;
  writeRegistry(registry);
  output(registry, flags.json);
  return 0;
}

async function status(flags) {
  const registry = readRegistry();
  if (!registry) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ services: {} }, null, 2)}\n`);
    } else {
      process.stdout.write('No dev services registered. Run pnpm dev:start first.\n');
    }
    return 0;
  }
  await refreshStatuses(registry);
  writeRegistry(registry);
  output(registry, flags.json);
  return 0;
}

function stop(flags) {
  const registry = readRegistry();
  if (!registry) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ services: {} }, null, 2)}\n`);
    } else {
      process.stdout.write('No dev services registered.\n');
    }
    return 0;
  }
  for (const name of serviceNames) {
    const service = registry.services?.[name];
    if (!service) continue;
    killTree(service.pid);
    service.status = 'stopped';
    delete service.error;
  }
  registry.stoppedAt = new Date().toISOString();
  markMobileMetadataStopped();
  writeRegistry(registry);
  output(registry, flags.json);
  return 0;
}

function readTail(relativePath, lineCount) {
  const absolute = path.join(root, relativePath);
  if (!existsSync(absolute)) return { path: relativePath, exists: false, total: 0, lines: [] };
  const text = readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return { path: relativePath, exists: true, total: lines.length, lines: lines.slice(-lineCount) };
}

function logs(serviceName, flags) {
  if (!serviceName || !serviceNames.includes(serviceName)) {
    throw new UsageError(`logs needs a service: ${serviceNames.join(', ')}`);
  }
  const paths = logPaths(serviceName);
  const result = {
    service: serviceName,
    lines: flags.lines,
    out: readTail(paths.out, flags.lines),
    err: readTail(paths.err, flags.lines),
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  for (const entry of [result.out, result.err]) {
    if (!entry.exists) {
      process.stdout.write(`${entry.path}: (missing)\n`);
      continue;
    }
    process.stdout.write(`== ${entry.path} (last ${entry.lines.length} of ${entry.total}) ==\n`);
    for (const line of entry.lines) process.stdout.write(`${line}\n`);
  }
  return 0;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage}\n`);
    return 1;
  }

  if (parsed.flags.help) {
    const stream = parsed.flags.json ? process.stderr : process.stdout;
    stream.write(`${usage}\n`);
    return 0;
  }
  if (!parsed.command) {
    process.stderr.write(`${usage}\n`);
    return 1;
  }

  switch (parsed.command) {
    case 'start':
      return start(parsed.flags);
    case 'status':
      return status(parsed.flags);
    case 'stop':
      return stop(parsed.flags);
    case 'logs':
      try {
        return logs(parsed.service, parsed.flags);
      } catch (error) {
        process.stderr.write(`${error.message}\n\n${usage}\n`);
        return 1;
      }
    default:
      process.stderr.write(`unknown command: ${parsed.command}\n\n${usage}\n`);
      return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  },
);
