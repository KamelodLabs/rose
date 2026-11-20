import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, '..');
const expoDir = path.join(mobileRoot, '.expo');
const metadataPath = path.join(expoDir, 'rose-dev.json');
const qrPath = path.join(expoDir, 'expo-go-qr.png');
const firstPort = 8081;
const readyTimeoutMs = 90_000;

const virtualInterface =
  /(vmware|virtualbox|vEthernet|hyper-v|wsl|docker|loopback|tailscale|zerotier|hamachi)/i;
const preferredInterface = /wi-?fi|ethernet|en0|en1|eth/i;

const startedAt = new Date().toISOString();

function lanCandidates() {
  const candidates = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    if (virtualInterface.test(name)) continue;
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isIpv4 || entry.internal) continue;
      candidates.push({ name, address: entry.address });
    }
  }
  return candidates;
}

function pickLanHost() {
  const override = process.env.EXPO_LAN_HOST?.trim();
  if (override) return override;

  const candidates = lanCandidates();
  if (candidates.length === 0) {
    console.error(
      '[rose-mobile] No usable LAN IPv4 address found. Connect Wi-Fi/Ethernet or set EXPO_LAN_HOST.',
    );
    process.exit(1);
  }

  const preferred = candidates.find((candidate) => preferredInterface.test(candidate.name));
  return (preferred ?? candidates[0]).address;
}

function probePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 100; port += 1) {
    if (await probePort(port)) return port;
  }
  throw new Error(`No free TCP port found from ${start} to ${start + 99}.`);
}

async function writeQr(url) {
  try {
    const qrcode = await import('qrcode');
    const qr = typeof qrcode.toFile === 'function' ? qrcode : qrcode.default;
    await qr.toFile(qrPath, url, { width: 512, margin: 2 });
  } catch (error) {
    console.warn(`[rose-mobile] warn: QR generation failed (${error.message}); URL still works.`);
  }
}

function buildMetadata({ mode, host, port, url, pid, status }) {
  return {
    mode,
    host,
    port,
    expoGoUrl: url,
    qrPath,
    metadataPath,
    pid: pid ?? null,
    status,
    startedAt,
    updatedAt: new Date().toISOString(),
  };
}

async function saveMetadata(metadata) {
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function killTree(pid) {
  return new Promise((resolve) => {
    const killer = spawn(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', 'taskkill', '/PID', String(pid), '/T', '/F'],
      { stdio: 'ignore', shell: false },
    );
    killer.once('exit', () => resolve());
    killer.once('error', () => resolve());
  });
}

async function main() {
  const mode = process.argv.includes('--localhost') ? 'localhost' : 'lan';
  const host = mode === 'localhost' ? '127.0.0.1' : pickLanHost();
  const port = await findFreePort(firstPort);
  const expoGoUrl = `exp://${host}:${port}`;

  await mkdir(expoDir, { recursive: true });
  await writeQr(expoGoUrl);
  await saveMetadata(
    buildMetadata({ mode, host, port, url: expoGoUrl, pid: null, status: 'starting' }),
  );

  const args = ['exec', 'expo', 'start', '--go'];
  args.push(mode === 'localhost' ? '--localhost' : '--lan', '--port', String(port));

  const env = { ...process.env };
  delete env.CI;
  if (mode === 'localhost') {
    delete env.REACT_NATIVE_PACKAGER_HOSTNAME;
  } else {
    env.REACT_NATIVE_PACKAGER_HOSTNAME = host;
  }

  const isWindows = process.platform === 'win32';
  const command = isWindows ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
  const commandArgs = isWindows ? ['/d', '/s', '/c', 'pnpm', ...args] : args;
  const child = spawn(command, commandArgs, {
    cwd: mobileRoot,
    stdio: 'inherit',
    env,
    shell: false,
  });

  let finished = false;

  const finalize = async (code, kill) => {
    if (finished) return;
    finished = true;
    if (kill && child.pid) {
      if (process.platform === 'win32') {
        await killTree(child.pid);
      } else {
        child.kill('SIGTERM');
      }
    }
    await saveMetadata(
      buildMetadata({
        mode,
        host,
        port,
        url: expoGoUrl,
        pid: child.pid,
        status: 'stopped',
      }),
    );
    process.exit(code);
  };

  child.once('exit', (code, signal) => {
    void finalize(code ?? (signal ? 1 : 0), false);
  });
  child.once('error', (error) => {
    console.error(`[rose-mobile] failed to start Expo: ${error.message}`);
    void finalize(1, false);
  });
  process.once('SIGINT', () => void finalize(0, true));
  process.once('SIGTERM', () => void finalize(0, true));

  await saveMetadata(
    buildMetadata({ mode, host, port, url: expoGoUrl, pid: child.pid, status: 'starting' }),
  );

  console.log(`[rose-mobile] mode=${mode} host=${host} port=${port}`);
  console.log(`[rose-mobile] expo-go: ${expoGoUrl}`);
  console.log(`[rose-mobile] qr: ${qrPath}`);
  console.log(`[rose-mobile] metadata: ${metadataPath}`);
  console.log('[rose-mobile] hint: In Expo Go, use "Enter URL manually" if the QR is not visible.');

  if (await waitForServer(port, readyTimeoutMs)) {
    await saveMetadata(
      buildMetadata({ mode, host, port, url: expoGoUrl, pid: child.pid, status: 'ready' }),
    );
    console.log('[rose-mobile] ready');
  } else {
    console.warn(`[rose-mobile] warn: server did not answer on 127.0.0.1:${port} within 90s.`);
  }
}

main().catch((error) => {
  console.error(`[rose-mobile] ${error.message}`);
  process.exit(1);
});
