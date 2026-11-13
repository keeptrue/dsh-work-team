#!/usr/bin/env node
/**
 * measure-context.mjs - measure the real context cost of one model request.
 *
 * Reads a DSH session log (zstd-compressed JSONL), decompresses it with the
 * system `zstd` binary (no npm dependency), and reports:
 *   - system/message characters (last system/message event, text blocks joined)
 *   - request/header tools size (JSON.stringify length) and tool count
 *   - how many times the injected prompt appears ("REFUSAL HARDENING" count)
 *   - one summary line: per-request total and the delta against the baseline
 *
 * Baseline, measured before the 2026-10-27 duplicate-injection fix
 * (session 00716d8f-911b-4222-b271-8b740fd1a1ec):
 *   system/message  79,338 chars  (that session's last system/message: 77,904)
 *   request/header  79,009 bytes  (101 tools)
 *   inject copies   2
 * After the fix the same kind of request is 46,586 chars / inject 1.
 *
 * `--check` in CI has nothing to measure (no session log in a fresh checkout): it
 * prints SKIP and exits 0. That is a skip, never a pass — a green CI run does not
 * mean the budget was verified, only that it could not be.
 *
 * Usage:
 *   node scripts/measure-context.mjs                # newest session in this workspace
 *   node scripts/measure-context.mjs <sessionId>    # one specific session
 *   node scripts/measure-context.mjs --tools        # also list tool names
 *   node scripts/measure-context.mjs --json         # machine-readable output
 *   node scripts/measure-context.mjs --check <maxSystemChars> <maxToolBytes>
 *                                                   # exit non-zero when a request
 *                                                   # exceeds the budget (CI guard)
 *
 * `--check` thresholds, measured 2026-11-13 on session b1fe1e2c-ffad-469a-ae90-5e4a2db43652
 * (this workspace, 110 tools):
 *   system/message  47,221 chars  -> limit  60,000  (+27.0%)
 *   request/header  87,084 bytes  -> limit 100,000  (+14.8%)
 * The system limit stays below the pre-2026-10-27 duplicate-injection baseline
 * (79,338 chars), so shipping the injected prompt twice fails the check instead of
 * quietly doubling it; the tools limit leaves room for roughly a dozen more tools.
 * With no session log (CI), the check SKIPS and says so — a skip is not a pass.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Pre-fix baseline. Keep in sync with the note above. */
const BASELINE = {
  system: 79_338,
  tools: 79_009,
  toolsCount: 101,
  inject: 2,
}

const INJECT_MARKER = 'REFUSAL HARDENING'
const ZSTD_CANDIDATES = [process.env.ZSTD, 'zstd', '/usr/bin/zstd', '/usr/local/bin/zstd'].filter(Boolean)

/** Budget used when `--check` is passed without numbers. Keep in sync with the note above. */
const CHECK_DEFAULTS = {
  system: 60_000,
  tools: 100_000,
}

function fail(message) {
  console.error(`measure-context: ${message}`)
  process.exit(1)
}

function usage(message) {
  fail(`${message}\n  usage: node scripts/measure-context.mjs [sessionId] [--tools] [--json] [--check [<maxSystemChars> <maxToolBytes>]]`)
}

/** DSH encodes a workspace path into its session directory name. */
function encodeWorkspace(dir) {
  const flat = path.resolve(dir).replace(/^[/\\]+/, '').replace(/[/\\]+/g, '-')
  return `--${flat}--`
}

function sessionsRootFor(cwd) {
  return path.join(os.homedir(), '.dsh', 'sessions', encodeWorkspace(cwd))
}

function sessionLogOf(dir) {
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const hit = names
    .filter((name) => /^session.*\.jsonl\.zstd$/.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return hit[0] ?? null
}

/** Newest session log under one workspace root. */
function newestLogIn(root) {
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  let best = null
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const log = sessionLogOf(path.join(root, entry.name))
    if (!log) continue
    const mtime = fs.statSync(log).mtimeMs
    if (!best || mtime > best.mtime) best = { sessionId: entry.name, log, mtime }
  }
  return best
}

/** Locate one session by id, first in this workspace, then across every workspace. */
function findSessionById(root, sessionId) {
  const direct = sessionLogOf(path.join(root, sessionId))
  if (direct) return { sessionId, log: direct, mtime: fs.statSync(direct).mtimeMs }
  const sessionsDir = path.dirname(root)
  let entries = []
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const log = sessionLogOf(path.join(sessionsDir, entry.name, sessionId))
    if (log) return { sessionId, log, mtime: fs.statSync(log).mtimeMs, workspace: entry.name }
  }
  return null
}

function zstdBinary() {
  for (const candidate of ZSTD_CANDIDATES) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (!probe.error && probe.status === 0) return candidate
  }
  fail(`no zstd binary found (tried: ${ZSTD_CANDIDATES.join(', ')})`)
}

function decompress(binary, file) {
  const run = spawnSync(binary, ['-dc', '--no-progress', file], {
    maxBuffer: 512 * 1024 * 1024,
    encoding: 'utf8',
  })
  if (run.error) fail(`cannot run ${binary}: ${run.error.message}`)
  const stdout = run.stdout || ''
  // A session file that is still being appended to can end mid-frame; zstd then
  // exits non-zero but still prints every complete frame. Keep what we got.
  if (!stdout.trim()) {
    fail(`zstd produced no output for ${file} (exit ${run.status}): ${(run.stderr || '').trim()}`)
  }
  return stdout
}

function parseEvents(text) {
  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // Truncated tail line: ignore.
    }
  }
  return events
}

function lastOfType(events, type) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === type) return events[i]
  }
  return null
}

function systemText(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .join('')
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

const num = (value) => Number(value).toLocaleString('en-US')

/** Read `--check [<maxSystemChars> <maxToolBytes>]` and drop its numbers from the positionals. */
function parseArgs(argv) {
  const opts = { wantTools: false, wantJson: false, limits: null }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--tools') {
      opts.wantTools = true
    } else if (arg === '--json') {
      opts.wantJson = true
    } else if (arg === '--check') {
      const numbers = []
      while (numbers.length < 2 && /^\d+$/.test(argv[i + 1] ?? '')) {
        numbers.push(Number(argv[i + 1]))
        i += 1
      }
      if (numbers.length === 1) usage('--check needs both limits, or neither')
      if (numbers.length === 2 && numbers.some((value) => value <= 0)) usage('--check limits must be positive')
      opts.limits = numbers.length === 2
        ? { system: numbers[0], tools: numbers[1] }
        : { ...CHECK_DEFAULTS }
    } else if (arg.startsWith('--')) {
      usage(`unknown flag "${arg}"`)
    } else {
      positional.push(arg)
    }
  }
  if (positional.length > 1) usage(`expected at most one session id, got ${positional.length}`)
  opts.sessionId = positional[0] ?? ''
  return opts
}

/** Compare one measurement against the budget; `over` is empty when the request fits. */
function evaluateCheck(report, limits) {
  const over = []
  if (report.systemChars > limits.system) {
    over.push({ metric: 'system/message', value: report.systemChars, max: limits.system, unit: 'chars' })
  }
  if (report.toolsBytes > limits.tools) {
    over.push({ metric: 'request/header', value: report.toolsBytes, max: limits.tools, unit: 'bytes' })
  }
  return { status: over.length === 0 ? 'pass' : 'fail', over }
}

function main() {
  const { wantTools, wantJson, limits, sessionId } = parseArgs(process.argv.slice(2))

  const root = sessionsRootFor(process.cwd())
  const target = sessionId ? findSessionById(root, sessionId) : newestLogIn(root)
  if (!target) {
    // A CI checkout has no session logs at all: measuring is impossible, so the
    // budget check has nothing to judge. Skipping is honest; passing is not.
    if (limits && !sessionId) {
      console.log(`context-check: SKIP  no session logs under ${root}`)
      console.log('context-check: nothing measured — this is a skip, not a pass (run a turn in this workspace to measure)')
      return
    }
    fail(sessionId
      ? `session "${sessionId}" not found under ${path.dirname(root)}`
      : `no session logs under ${root} (run a turn in this workspace first)`)
  }

  const events = parseEvents(decompress(zstdBinary(), target.log))
  const systemEvent = lastOfType(events, 'system/message')
  const headerEvent = lastOfType(events, 'request/header')
  if (!systemEvent) fail(`no system/message event in ${target.log}`)

  const system = systemText(systemEvent)
  const tools = headerEvent?.data?.header?.tools
  const toolsJson = Array.isArray(tools) ? JSON.stringify(tools) : ''
  const toolNames = Array.isArray(tools)
    ? tools.map((tool) => String(tool?.name ?? tool?.function?.name ?? '')).filter(Boolean)
    : []

  const report = {
    sessionId: target.sessionId,
    workspace: target.workspace ?? encodeWorkspace(process.cwd()),
    file: target.log,
    events: events.length,
    systemChars: system.length,
    injectCount: countOccurrences(system, INJECT_MARKER),
    toolsBytes: toolsJson.length,
    toolsCount: toolNames.length,
    total: system.length + toolsJson.length,
    baseline: BASELINE.system + BASELINE.tools,
    toolNames,
  }

  const check = limits ? evaluateCheck(report, limits) : null
  if (check) report.check = { ...check, maxSystemChars: limits.system, maxToolBytes: limits.tools }

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2))
    if (check && check.status === 'fail') process.exitCode = 1
    return
  }

  const delta = report.total - report.baseline
  const pct = report.baseline ? (delta / report.baseline) * 100 : 0
  const sign = delta > 0 ? '+' : ''

  console.log(`session   ${report.sessionId}`)
  console.log(`file      ${report.file}`)
  console.log(`events    ${num(report.events)}`)
  console.log('')
  console.log(`system/message   ${num(report.systemChars).padStart(9)} chars   inject x${report.injectCount}   (baseline ${num(BASELINE.system)} / x${BASELINE.inject})`)
  console.log(`request/header   ${num(report.toolsBytes).padStart(9)} bytes   ${report.toolsCount} tools   (baseline ${num(BASELINE.tools)} / ${BASELINE.toolsCount})`)
  console.log('')
  console.log(`per request      ${num(report.total).padStart(9)}  (system chars + tools bytes)`)
  console.log(`baseline         ${num(report.baseline).padStart(9)}  (${num(BASELINE.system)} + ${num(BASELINE.tools)})`)
  console.log(`delta            ${(sign + num(delta)).padStart(9)}  (${sign}${pct.toFixed(1)}%)`)

  if (check) {
    console.log('')
    if (check.status === 'pass') {
      console.log(`context-check: PASS  system ${num(report.systemChars)} <= ${num(limits.system)} chars, `
        + `tools ${num(report.toolsBytes)} <= ${num(limits.tools)} bytes`)
    } else {
      console.log('context-check: FAIL')
      for (const item of check.over) {
        console.log(`  ${item.metric}  ${num(item.value)} > ${num(item.max)} ${item.unit}  (${num(item.value - item.max)} over)`)
      }
      process.exitCode = 1
    }
  }

  if (wantTools) {
    console.log('')
    console.log(`tools (${report.toolsCount}):`)
    for (const name of report.toolNames) console.log(`  ${name}`)
  }
}

main()
