import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadConfig, saveDefaultConfig } from '../config.mjs'
const KNOWTIFY_BIN = fileURLToPath(new URL('../../bin/knowtify.mjs', import.meta.url))
import { aggregate, getActivePrompts, loadState, markNotified, saveState } from './aggregator.mjs'
import { getProviders, readPushEvents, scanAll } from '../providers/index.mjs'
import { dispatchResponse, respondById } from '../responders/index.mjs'
import { sendNotification } from '../notifier/index.mjs'
import { ensureDirs, PID_PATH, PENDING_DIR } from '../paths.mjs'
import { info, error, debug } from '../logger.mjs'

/** @type {NodeJS.Timeout | null} */
let pollTimer = null

function hasActivePending(sessionId) {
  if (!sessionId || !fs.existsSync(PENDING_DIR)) return false
  return fs.readdirSync(PENDING_DIR).some((f) => f.includes(String(sessionId)))
}

export async function runScan() {
  const config = loadConfig()
  const providers = getProviders(config.enabledProviders)
  const results = await scanAll(providers)
  const polled = results.flatMap((r) => r.prompts)
  const pushed = readPushEvents()
  const incoming = [...polled, ...pushed]

  const { state, toNotify, cleared } = aggregate(incoming, config.renotifyAfterMs)
  saveState(state)

  for (const id of cleared) {
    debug('prompt cleared', { id })
  }

  for (const prompt of toNotify) {
    // PermissionRequest hook handles rich notifications — skip duplicate poll alerts
    if (hasActivePending(prompt.sessionId)) {
      debug('skipping poll notify — PermissionRequest hook active', { sessionId: prompt.sessionId })
      markNotified(state, prompt.id)
      continue
    }
    sendNotification(prompt)
    markNotified(state, prompt.id)
    info('notified', { id: prompt.id, tool: prompt.tool, project: prompt.project })
  }
  saveState(state)

  return { results, active: getActivePrompts(state), notified: toNotify.length }
}

/**
 * @param {string} promptId
 * @param {import('../types.mjs').ResponseAction} action
 */
export async function handleResponse(promptId, action) {
  // PermissionRequest hook path — write response file for hook to pick up
  const hookHandled = await respondById(promptId, action)
  if (hookHandled) {
    info('responded via permission-request', { promptId, action })
    return true
  }

  const state = loadState()
  const tracked = state[promptId]
  if (!tracked) {
    error('unknown prompt id', { promptId })
    return false
  }

  const ok = await dispatchResponse(tracked.prompt, action)
  if (ok) {
    delete state[promptId]
    saveState(state)
    info('responded', { promptId, action })
  }
  return ok
}

export async function startDaemon() {
  ensureDirs()
  saveDefaultConfig()

  if (fs.existsSync(PID_PATH)) {
    const oldPid = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10)
    try {
      process.kill(oldPid, 0)
      console.log(`Knowtify already running (pid ${oldPid})`)
      return
    } catch {
      // stale pid file
    }
  }

  if (process.argv.includes('--foreground')) {
    await runDaemonLoop()
    return
  }

  const { spawn } = await import('child_process')
  const daemon = spawn(
    process.execPath,
    [KNOWTIFY_BIN, 'start', '--foreground'],
    { detached: true, stdio: 'ignore', env: process.env },
  )
  daemon.unref()
  console.log(`Knowtify started (pid ${daemon.pid})`)
}

async function runDaemonLoop() {
  fs.writeFileSync(PID_PATH, String(process.pid))
  info('daemon started', { pid: process.pid })

  const config = loadConfig()

  const tick = async () => {
    try {
      await runScan()
    } catch (err) {
      error('scan failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  await tick()
  pollTimer = setInterval(tick, config.pollIntervalMs)

  const shutdown = () => {
    if (pollTimer) clearInterval(pollTimer)
    try { fs.unlinkSync(PID_PATH) } catch { /* ignore */ }
    info('daemon stopped')
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

export function stopDaemon() {
  if (!fs.existsSync(PID_PATH)) {
    console.log('Knowtify is not running')
    return
  }
  const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10)
  try {
    process.kill(pid, 'SIGTERM')
    fs.unlinkSync(PID_PATH)
    console.log(`Stopped Knowtify (pid ${pid})`)
  } catch {
    fs.unlinkSync(PID_PATH)
    console.log('Removed stale pid file')
  }
}

export async function printStatus() {
  ensureDirs()
  const config = loadConfig()
  const providers = getProviders(config.enabledProviders)
  const results = await scanAll(providers)
  const state = loadState()
  const active = getActivePrompts(state)

  const running = fs.existsSync(PID_PATH)
  let daemonPid = null
  if (running) {
    daemonPid = fs.readFileSync(PID_PATH, 'utf8').trim()
    try {
      process.kill(parseInt(daemonPid, 10), 0)
    } catch {
      daemonPid = null
    }
  }

  console.log('Knowtify Status')
  console.log('───────────────')
  console.log(`Daemon: ${daemonPid ? `running (pid ${daemonPid})` : 'stopped'}`)
  console.log(`Poll interval: ${config.pollIntervalMs}ms`)
  console.log()

  for (const r of results) {
    const status = r.available ? (r.error ? `error: ${r.error}` : 'ok') : 'not installed'
    console.log(`  ${r.providerId}: ${status}`)
  }
  console.log()

  if (active.length === 0) {
    console.log('No prompts waiting for input.')
    return
  }

  console.log(`${active.length} prompt(s) waiting:`)
  for (const p of active) {
    console.log(`  ● ${p.tool} · ${p.project} — ${p.summary}`)
    console.log(`    id: ${p.id}`)
    if (p.pid) console.log(`    pid: ${p.pid}`)
  }
}
