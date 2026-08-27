#!/usr/bin/env node
// Builds (and optionally zips) the extension for one or more browser targets.
//   node scripts/build.mjs [--package] [--watch] [chrome|firefox ...]
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ALL_TARGETS = ['chrome', 'firefox'];

const args = process.argv.slice(2);
const shouldPackage = args.includes('--package');
const watch = args.includes('--watch');
const requested = args.filter((arg) => !arg.startsWith('--'));

for (const target of requested) {
  if (!ALL_TARGETS.includes(target)) {
    console.error(`Unknown target "${target}". Use one of: ${ALL_TARGETS.join(', ')}.`);
    process.exit(1);
  }
}

const targets = requested.length > 0 ? requested : ALL_TARGETS;

if (watch && targets.length > 1) {
  console.error('--watch supports a single target, e.g. `npm run dev -- firefox`.');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');

function run(command, commandArgs, { env, cwd } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: cwd ?? root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env }
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const target of targets) {
  run('npx', ['vite', 'build', ...(watch ? ['--watch'] : [])], { env: { EXT_TARGET: target } });

  if (!shouldPackage) {
    continue;
  }

  const zipName = `email-alias-extension-${target}.zip`;
  mkdirSync(resolve(root, 'release'), { recursive: true });
  rmSync(resolve(root, 'release', zipName), { force: true });
  run('python3', ['-m', 'zipfile', '-c', resolve(root, 'release', zipName), '.'], {
    cwd: resolve(root, 'dist', target)
  });
  console.log(`Packaged release/${zipName}`);
}
