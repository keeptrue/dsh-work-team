#!/usr/bin/env node
/**
 * Link the host packages this plugin imports at runtime.
 *
 * `index.js` imports `@deepseek-ai/schemastery` and `@deepseek-ai/dsh-tools`.
 * Both ship with the DSH installation, not with this repository, so a fresh
 * clone has no `node_modules` to resolve them from. This script locates the
 * installation that owns the `dsh` binary and symlinks those packages into
 * `node_modules/@deepseek-ai/`.
 *
 * Usage:
 *   node scripts/link-host-deps.mjs            # find the `dsh` binary on PATH
 *   node scripts/link-host-deps.mjs --host DIR # use DIR as the install root
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_PACKAGES = ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools'];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Read `--host <dir>` without pulling in an argument parser. */
function hostArgument(argv) {
  const index = argv.indexOf('--host');
  return index === -1 ? '' : (argv[index + 1] ?? '');
}

/** Real path of the `dsh` binary, or an empty string when it is not on PATH. */
function dshBinary() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const found = execFileSync(finder, ['dsh'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    return found === '' ? '' : realpathSync(found);
  } catch {
    return '';
  }
}

/** Walk up from a starting directory until a DSH install root is found. */
function installRootFrom(start) {
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    const probe = join(current, 'node_modules', HOST_PACKAGES[0], 'package.json');
    if (existsSync(probe)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '';
}

/** Resolve the DSH installation root that carries the host packages. */
function installRoot() {
  const explicit = hostArgument(process.argv);
  if (explicit !== '') {
    const root = resolve(explicit);
    if (installRootFrom(root) === '') {
      throw new Error(`--host ${root} does not contain node_modules/${HOST_PACKAGES[0]}`);
    }
    return root;
  }
  const binary = dshBinary();
  if (binary === '') {
    throw new Error('`dsh` is not on PATH; pass --host <dsh install dir> instead');
  }
  const root = installRootFrom(dirname(binary));
  if (root === '') {
    throw new Error(`could not find ${HOST_PACKAGES[0]} above ${binary}; pass --host <dsh install dir>`);
  }
  return root;
}

function linkOne(root, name) {
  const source = join(root, 'node_modules', name);
  if (!existsSync(join(source, 'package.json'))) {
    return `skipped ${name} (not installed in ${root})`;
  }
  const target = join(repoRoot, 'node_modules', name);
  mkdirSync(dirname(target), { recursive: true });

  if (existsSync(target) || isBrokenLink(target)) {
    const stats = lstatSync(target);
    if (!stats.isSymbolicLink()) {
      return `kept ${name} (already a real directory)`;
    }
    const current = realpathSync(target);
    if (current === realpathSync(source)) return `linked ${name} (already correct)`;
    unlinkSync(target);
  }

  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  return `linked ${name} -> ${source}`;
}

/** `existsSync` follows links, so a dangling symlink needs its own probe. */
function isBrokenLink(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

try {
  const root = installRoot();
  console.log(`DSH install: ${root}`);
  for (const name of HOST_PACKAGES) console.log(linkOne(root, name));
} catch (error) {
  console.error(`link-host-deps: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
