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
 * Usage:
 *   node scripts/measure-context.mjs                # newest session in this workspace
 *   node scripts/measure-context.mjs <sessionId>    # one specific session
 *   node scripts/measure-context.mjs --tools        # also list tool names
 *   node scripts/measure-context.mjs --json         # machine-readable output
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

function fail(message) {
  console.error(`measure-context: ${message}`)
  process.exit(1)
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

function main() {
  const argv = process.argv.slice(2)
  const wantTools = argv.includes('--tools')
  const wantJson = argv.includes('--json')
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  if (positional.length > 1) fail(`expected at most one session id, got ${positional.length}`)

  const root = sessionsRootFor(process.cwd())
  const target = positional[0] ? findSessionById(root, positional[0]) : newestLogIn(root)
  if (!target) {
    fail(positional[0]
      ? `session "${positional[0]}" not found under ${path.dirname(root)}`
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

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2))
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

  if (wantTools) {
    console.log('')
    console.log(`tools (${report.toolsCount}):`)
    for (const name of report.toolNames) console.log(`  ${name}`)
  }
}

main()
