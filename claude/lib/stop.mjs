import fs from 'fs'
import path from 'path'
import { showDialog, showOptionsDialog, showNotification } from '../../core/dialog.mjs'
import { isHostAppFrontmost, focusHostApp } from '../../core/focus.mjs'
import { createLogger } from '../../core/logger.mjs'

const defaultLog = createLogger('claude')

// ──────────────────────────────────────────────────────────
// Pure transformers
// ──────────────────────────────────────────────────────────

/**
 * Read the last assistant text message from a Claude Code transcript (JSONL).
 * @param {string} transcriptPath
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 * @returns {string}
 */
export function readLastAssistantMessage(transcriptPath, io = {}) {
  const exists = io.existsSync ?? fs.existsSync
  const read = io.readFileSync ?? fs.readFileSync
  if (!transcriptPath || !exists(transcriptPath)) return ''

  let lines
  try {
    lines = read(transcriptPath, 'utf8').split('\n').filter(Boolean)
  } catch {
    return ''
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    let entry
    try { entry = JSON.parse(lines[i]) } catch { continue }
    if (entry?.type !== 'assistant') continue
    const content = entry?.message?.content
    if (!Array.isArray(content)) continue
    const text = content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

/**
 * Heuristic: does this assistant message look like it's asking the user
 * something (i.e. waiting for a free-form answer)?
 * @param {string} message
 */
export function looksLikeQuestion(message) {
  if (!message) return false
  const trimmed = message.trim()
  if (!trimmed) return false

  if (/\?["')\]]*\s*$/.test(trimmed)) return true

  const tail = trimmed.split('\n').slice(-6).join('\n')
  if (tail.includes('?')) return true

  // Keyword fallback for questions phrased without a '?'. Deliberately narrow —
  // weak words like "continue"/"proceed"/"approach" fire on completion messages
  // ("I'll continue…", "this approach works") and caused false-positive dialogs.
  const keywords = /\b(which|should i|do you want|would you like|let me know|pick one)\b/i
  if (keywords.test(tail)) return true

  return false
}

/**
 * Duration of the just-finished turn, derived from transcript timestamps:
 * the human prompt that started the turn → the final assistant message.
 *
 * NOTE: we deliberately do NOT read Claude's own `system`/`turn_duration`
 * entry. The CLI appends that line *after* the Stop hooks run (it sits after
 * `stop_hook_summary` in the file), so at hook time it doesn't exist yet for
 * the current turn — reading it would surface the *previous* turn's value.
 * It also bakes in the Stop hooks' own runtime, inflating the number. The
 * prompt→final-answer span is the stable, honest measure and, with our
 * completion banner firing instantly, tracks the CLI's displayed time closely.
 *
 * Tool-result entries (recorded as `user` type) and sub-agent sidechain entries
 * are skipped so we anchor to the actual human prompt of the main thread.
 *
 * @returns {number | null} milliseconds, or null if it can't be determined
 */
export function readTurnDurationMs(transcriptPath, io = {}) {
  const exists = io.existsSync ?? fs.existsSync
  const read = io.readFileSync ?? fs.readFileSync
  if (!transcriptPath || !exists(transcriptPath)) return null

  let lines
  try {
    lines = read(transcriptPath, 'utf8').split('\n').filter(Boolean)
  } catch {
    return null
  }

  const parse = (line) => { try { return JSON.parse(line) } catch { return null } }
  const isMain = (e) => Boolean(e) && e.isSidechain !== true

  // End = the final assistant message of the turn.
  let endTs = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = parse(lines[i])
    if (isMain(e) && e.type === 'assistant' && e.timestamp) { endTs = Date.parse(e.timestamp); break }
  }
  if (!endTs) return null

  // Start = the human prompt that began the turn (skip tool_result "user" entries).
  let startTs = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = parse(lines[i])
    if (!isMain(e) || e.type !== 'user' || !e.timestamp) continue
    const content = e?.message?.content
    const isToolResult = Array.isArray(content) && content.some(c => c?.type === 'tool_result')
    if (isToolResult) continue
    startTs = Date.parse(e.timestamp)
    break
  }
  if (!startTs) return null

  const ms = endTs - startTs
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/** Humanize a millisecond duration: "20s", "1m 5s", "2h 3m". */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), remS = s % 60
  if (m < 60) return remS ? `${m}m ${remS}s` : `${m}m`
  const h = Math.floor(m / 60), remM = m % 60
  return remM ? `${h}h ${remM}m` : `${h}h`
}

/** Build the banner label from Claude's real turn duration, e.g. "✻ Clauding for 20s". */
export function completionLabel(durationMs) {
  return durationMs != null ? `✻ Clauding for ${formatDuration(durationMs)}` : '✻ Clauding'
}

/** Trim message for display, keeping the tail where the question usually is. */
export function forDisplay(message, max = 1500) {
  const t = String(message || '').trim()
  if (t.length <= max) return t
  return '…\n' + t.slice(t.length - max)
}

/**
 * Detect an enumerated multiple-choice list inside a free-text message — lines
 * like "A. foo", "B) bar", "1. baz", "2) qux" (Claude often writes choices as
 * prose rather than via the AskUserQuestion tool). Returns the question text
 * (the message with the option lines removed) and the option lines verbatim, so
 * each can become a clickable button. Requires >= 2 options; otherwise returns
 * null (it isn't a pick-one question).
 *
 * @param {string} message
 * @returns {{ question: string, options: string[] } | null}
 */
export function parseOptions(message) {
  const lines = String(message || '').split('\n')
  // Single letter (A–Z) or 1–2 digit number, then '.'/')' then real content.
  const optionRe = /^\s*(?:[A-Za-z]|\d{1,2})[.)]\s+\S.*$/
  const options = []
  const rest = []
  for (const line of lines) {
    if (optionRe.test(line)) options.push(line.trim())
    else rest.push(line)
  }
  if (options.length < 2) return null
  return { question: rest.join('\n').trim(), options }
}

// ──────────────────────────────────────────────────────────
// Orchestrator (side effects injected)
// ──────────────────────────────────────────────────────────

/**
 * Handle a Claude Stop hook. Fires only when the user is NOT focused on the
 * Claude window. If the last assistant message looks like a question:
 *   - when the message lists enumerated options (A./B)/1. …), show a button per
 *     option plus Open Claude / Dismiss; clicking an option injects it back to
 *     Claude (`decision: 'block'`) so it continues with that answer.
 *   - otherwise show the small "Claude is waiting" dialog whose primary button
 *     jumps the user back to the Claude window to reply there.
 * If the message isn't a question, fire a tiny completion banner instead.
 *
 * Returns the Stop-hook JSON (`{ decision: 'block', reason }`) when an option
 * was picked; otherwise null (notify / refocus / let Claude stop).
 *
 * @param {Record<string, unknown>} input
 * @param {{
 *   showDialog?: typeof showDialog,
 *   showOptionsDialog?: typeof showOptionsDialog,
 *   showNotification?: typeof showNotification,
 *   focusHostApp?: typeof focusHostApp,
 *   isHostAppFrontmost?: typeof isHostAppFrontmost,
 *   readTranscript?: (p: string) => string,
 *   readDurationMs?: (p: string) => number | null,
 *   log?: (level: string, msg: string, extra?: unknown) => void,
 * }} [deps]
 * @returns {{ decision: 'block', reason: string } | null}
 */
export function handleStop(input, deps = {}) {
  const show = deps.showDialog ?? showDialog
  const showOptions = deps.showOptionsDialog ?? showOptionsDialog
  const notify = deps.showNotification ?? showNotification
  const focus = deps.focusHostApp ?? focusHostApp
  const frontmost = deps.isHostAppFrontmost ?? isHostAppFrontmost
  const readTranscript = deps.readTranscript ?? ((p) => readLastAssistantMessage(p))
  const readDurationMs = deps.readDurationMs ?? ((p) => readTurnDurationMs(p))
  const log = deps.log ?? defaultLog

  const transcriptPath = String(input.transcript_path || '')
  const project = path.basename(String(input.cwd || path.dirname(transcriptPath) || 'unknown'))

  log('info', 'stop hook invoked', {
    session_id: input.session_id,
    stop_hook_active: input.stop_hook_active,
    transcript_path: transcriptPath,
  })

  if (frontmost()) {
    log('info', 'claude window frontmost, skipping')
    return null
  }

  const message = readTranscript(transcriptPath)
  if (!looksLikeQuestion(message)) {
    // Claude finished without needing input → tiny "✻ Clauding for 20s" banner
    // with a pleasant chime, not a modal dialog.
    const label = completionLabel(readDurationMs(transcriptPath))
    log('info', 'completion notification', { project, label })
    notify({ title: label, message: project, sound: 'Glass' })
    return null
  }

  // Log only metadata, never the message text — it can contain secrets.
  log('info', 'showing reply prompt', { project, messageChars: message.length })

  // If Claude listed enumerated choices, render a button per option. Picking one
  // injects it back so Claude answers itself; Open Claude / Dismiss still apply.
  const parsed = parseOptions(message)
  if (parsed) {
    const picked = showOptions({
      title: `Knowtify · Claude — ${project}`,
      heading: 'Claude is waiting for your reply',
      body: parsed.question || forDisplay(message),
      options: parsed.options,
      openLabel: 'Open Claude',
      dismissLabel: 'Dismiss',
    })

    if (picked.result === 'option' && picked.label) {
      log('info', 'option picked → injecting reply', { project, optionChars: picked.label.length })
      return { decision: 'block', reason: picked.label }
    }
    if (picked.result === 'open') {
      log('info', 'opening claude window')
      focus()
      return null
    }
    if (picked.result === 'dismiss') {
      log('info', 'dismissed, letting claude stop')
      return null
    }
    // 'unavailable' → fall through to the plain two-button dialog below.
  }

  // Plain free-form question (or no options backend). Offer to jump back to the
  // Claude window so the user replies there.
  const { result } = show({
    title: `Knowtify · Claude — ${project}`,
    body: `Claude is waiting for your reply:\n\n${forDisplay(message)}`,
    allowLabel: 'Open Claude',
    denyLabel: 'Dismiss',
  })

  if (result === 'allow') {
    log('info', 'opening claude window')
    focus()
  } else {
    log('info', 'dismissed, letting claude stop')
  }
  return null
}
