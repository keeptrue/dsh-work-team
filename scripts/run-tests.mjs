#!/usr/bin/env node
/**
 * Run the unit tests with node's built-in test runner.
 *
 * Why not `node --test test/`: on Node 22 a directory argument is resolved as a
 * module path, so the run dies with "Cannot find module .../test". Why not
 * `node --test test/*.test.js` in package.json: that needs a POSIX shell to expand
 * the glob — npm runs scripts through cmd.exe on Windows, and Node 20's --test has
 * no glob support of its own, so the pattern would arrive verbatim and fail there.
 *
 * This runner enumerates the files itself, which makes `npm test` behave the same
 * on every supported Node line and shell. It takes every name node's test runner
 * recognises (`*.test.js`, `*-test.js`, `test-*.js`), so a file is never skipped
 * just because it picked one of the other two conventions, and it keeps
 * `test/support/` out (fixtures, not test files).
 *
 * Two guards turn a silent skip into a failure:
 *   - fewer than EXPECTED_MIN_FILES files found -> something stopped matching;
 *   - a file that imports `node:test` but matches no pattern -> it would never run.
 *
 * Usage:
 *   node scripts/run-tests.mjs               # what `npm test` runs
 *   node scripts/run-tests.mjs --test-only   # extra flags go to node --test
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testRoot = path.join(repoRoot, 'test')
const FIXTURE_DIR = 'support'

/**
 * Floor for the file count. Bump it when test files are added; it exists only to
 * catch a rename or a moved directory that would silently drop tests from the run.
 */
const EXPECTED_MIN_FILES = 16

/** The three conventions node's test runner resolves when it walks a directory. */
const MATCHES = [
  (name) => name.endsWith('.test.js'),
  (name) => name.endsWith('-test.js'),
  (name) => /^test-.+\.js$/.test(name),
]

const matchesTestFile = (name) => MATCHES.some((match) => match(name))

/** True when the file itself imports the test runner — i.e. it is a test file. */
function importsNodeTest(file) {
  try {
    return /(?:from|require\()\s*['"]node:test['"]/.test(fs.readFileSync(file, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Walk `dir` for test files. Symlinked directories are followed (Dirent reports
 * them as neither directory nor file); a link back into a directory already seen
 * is skipped and reported instead of recursing forever.
 */
function walk(dir, state) {
  const real = fs.realpathSync(dir)
  if (state.seenDirs.has(real)) {
    state.loops.push(dir)
    return []
  }
  state.seenDirs.add(real)

  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    let isDir = entry.isDirectory()
    let isFile = entry.isFile()

    if (entry.isSymbolicLink()) {
      let stats
      try {
        stats = fs.statSync(full)
      } catch {
        state.unreadable.push(full)
        continue
      }
      isDir = stats.isDirectory()
      isFile = stats.isFile()
    }

    if (isDir) {
      // Fixtures live in test/support/ and are imported by tests, never run as one.
      if (dir === testRoot && entry.name === FIXTURE_DIR) continue
      found.push(...walk(full, state))
    } else if (isFile && entry.name.endsWith('.js')) {
      if (matchesTestFile(entry.name)) found.push(full)
      else state.candidates.push(full)
    }
  }
  return found
}

const state = { seenDirs: new Set(), loops: [], unreadable: [], candidates: [] }
let files
try {
  files = walk(testRoot, state).sort()
} catch (error) {
  console.error(`run-tests: cannot read ${testRoot}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

for (const dir of state.loops) console.error(`run-tests: skipped symlink cycle at ${dir}`)
for (const file of state.unreadable) console.error(`run-tests: skipped dangling symlink ${file}`)

const strays = state.candidates.filter(importsNodeTest)
if (strays.length > 0) {
  console.error(`run-tests: ${strays.length} file(s) import node:test but match no test pattern, so they would never run:`)
  for (const file of strays) console.error(`  ${path.relative(repoRoot, file)}`)
  console.error('run-tests: rename it to *.test.js, *-test.js or test-*.js, or move it under test/support/ if it is a fixture')
  process.exit(1)
}

if (files.length < EXPECTED_MIN_FILES) {
  console.error(`run-tests: found ${files.length} test file(s) under test/, expected at least ${EXPECTED_MIN_FILES}`)
  console.error('run-tests: a naming mismatch or a moved directory would silently drop tests — check the patterns (*.test.js, *-test.js, test-*.js) before lowering EXPECTED_MIN_FILES')
  process.exit(1)
}

console.log(`run-tests: ${files.length} files under test/`)

const run = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  stdio: 'inherit',
  cwd: repoRoot,
})
process.exit(run.status ?? 1)
