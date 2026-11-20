import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';

const [outPath, errPath, commandLine] = process.argv.slice(2);
if (!outPath || !errPath || !commandLine) {
  console.error('Usage: node docs/scripts/run-service.mjs <out.log> <err.log> <command line>');
  process.exit(2);
}

const out = openSync(outPath, 'w');
const err = openSync(errPath, 'w');
const isWindows = process.platform === 'win32';
const executable = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
const args = isWindows ? ['/d', '/s', '/c', commandLine] : ['-c', commandLine];

const child = spawn(executable, args, {
  stdio: ['ignore', out, err],
  windowsHide: true,
  shell: false,
});

child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
