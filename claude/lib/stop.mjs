import fs from 'fs'
import path from 'path'
import { showDialog, showOptionsDialog, showNotification } from '../../core/dialog.mjs'
import { isHostAppFrontmost, focusHostApp } from '../../core/focus.mjs'
import { createLogger } from '../../core/logger.mjs'
import { getConfig } from '../../core/config.mjs'
import { withTip } from './tips.mjs'

const defaultLog = createLogger('claude')

// ──────────────────────────────────────────────────────────
// Pure transformers
// ──────────────────────────────────────────────────────────

/**
 * Read + parse a Claude Code transcript (JSONL) a single time → parsed entries
 * (unparseable lines dropped). Both the last-message and turn-duration
 * extractors below work off this one snapshot, so the Stop hook reads the file
 * once per invocation instead of twice.
 * @param {string} transcriptPath
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 * @returns {Array<Record<string, any>>}
 */
export function readTranscriptEntries(transcriptPath, io = {}) {
  const exists = io.existsSync ?? fs.existsSync
  const read = io.readFileSync ?? fs.readFileSync
  if (!transcriptPath || !exists(transcriptPath)) return []

  let raw
  try {
    raw = read(transcriptPath, 'utf8')
  } catch {
    return []
  }

  const entries = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try { entries.push(JSON.parse(line)) } catch { /* skip malformed line */ }
  }
  return entries
}

/**
 * Last assistant text message from already-parsed transcript entries.
 * @param {Array<Record<string, any>>} entries
 * @returns {string}
 */
function lastAssistantMessageFromEntries(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
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
 * Read the last assistant text message from a Claude Code transcript (JSONL).
 * @param {string} transcriptPath
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 * @returns {string}
 */
export function readLastAssistantMessage(transcriptPath, io = {}) {
  return lastAssistantMessageFromEntries(readTranscriptEntries(transcriptPath, io))
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
  // "which" is only interrogative when it leads into a choice ("which one/of/
  // option/do you/would you/should i…"); the bare relative pronoun ("…which is
  // why", "…which means") is declarative and must NOT count as a question.
  const keywords = /\b(which (one|of|option|approach|do you|would you|should i)|should i|do you want|would you like|let me know|pick one)\b/i
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
function turnDurationFromEntries(entries) {
  const isMain = (e) => Boolean(e) && e.isSidechain !== true

  // End = the final assistant message of the turn.
  let endTs = null
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (isMain(e) && e.type === 'assistant' && e.timestamp) { endTs = Date.parse(e.timestamp); break }
  }
  if (!endTs) return null

  // Start = the human prompt that began the turn (skip tool_result "user" entries).
  let startTs = null
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
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

export function readTurnDurationMs(transcriptPath, io = {}) {
  return turnDurationFromEntries(readTranscriptEntries(transcriptPath, io))
}

/**
 * The human prompt that started this turn, from already-parsed entries: the most
 * recent main-thread `user` entry that's an actual prompt (not a tool_result).
 * Used to label notifications so you can tell which terminal is asking.
 * @param {Array<Record<string, any>>} entries
 * @returns {string}
 */
function lastUserPromptFromEntries(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (!e || e.isSidechain === true || e.type !== 'user') continue
    const content = e?.message?.content
    if (typeof content === 'string') {
      const t = content.trim()
      if (t) return t
      continue
    }
    if (Array.isArray(content)) {
      if (content.some(c => c?.type === 'tool_result')) continue // tool output, not a prompt
      const t = content
        .filter(c => c && c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text)
        .join('\n')
        .trim()
      if (t) return t
    }
  }
  return ''
}

/** First non-empty line of `text`, trimmed and capped (ellipsis if truncated). */
export function firstLine(text, max = 100) {
  const line = String(text || '').split('\n').map(s => s.trim()).find(Boolean) || ''
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line
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
 *   readTranscriptEntries?: (p: string) => Array<Record<string, any>>,
 *   readTranscript?: (p: string) => string,
 *   readDurationMs?: (p: string) => number | null,
 *   readUserPrompt?: () => string,
 *   config?: import('../../core/config.mjs').Config,
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
  const config = deps.config ?? getConfig()
  const log = deps.log ?? defaultLog

  const transcriptPath = String(input.transcript_path || '')

  // Read + parse the transcript at most once per invocation (lazily, only if we
  // get past the frontmost check), then derive both the last message and the
  // turn duration from the same snapshot. Explicit deps still override for tests.
  const readEntries = deps.readTranscriptEntries ?? ((p) => readTranscriptEntries(p))
  let entriesCache
  const entries = () => (entriesCache ??= readEntries(transcriptPath))
  const readTranscript = deps.readTranscript ?? (() => lastAssistantMessageFromEntries(entries()))
  const readDurationMs = deps.readDurationMs ?? (() => turnDurationFromEntries(entries()))
  const readUserPrompt = deps.readUserPrompt ?? (() => firstLine(lastUserPromptFromEntries(entries())))
  const project = path.basename(String(input.cwd || path.dirname(transcriptPath) || 'unknown'))

  log('info', 'stop hook invoked', {
    session_id: input.session_id,
    stop_hook_active: input.stop_hook_active,
    transcript_path: transcriptPath,
  })

  // 'always' opts out of focus-suppression entirely (the only way to hear about
  // a Claude finishing in a background terminal *tab* of the focused window —
  // tabs can't be told apart from the foreground one).
  const isFront = frontmost()
  if (config.notifyWhen !== 'always' && isFront) {
    log('info', 'claude window frontmost, skipping')
    return null
  }

  // When you're focused on this very window (only reachable in 'always' mode), a
  // blocking modal would interrupt what you're doing — downgrade to a
  // non-blocking banner. When you're away, honor the configured style so the
  // dialog (and its clickable choices) still appears.
  const effectiveStyle = isFront ? 'notify' : config.style

  const message = readTranscript(transcriptPath)

  // The first line of the user's prompt, used as the banner body so you can tell
  // which terminal a notification came from when several are running. Falls back
  // to the project name when there's no prompt to show (keeps the body non-empty,
  // which macOS requires to render the banner at all).
  const promptLine = readUserPrompt()
  const bannerBody = promptLine || project

  if (!looksLikeQuestion(message)) {
    // Claude finished without needing input → tiny "✻ Clauding for 20s" banner
    // with a pleasant chime, not a modal dialog.
    const label = completionLabel(readDurationMs(transcriptPath))
    log('info', 'completion notification', { project, label })
    notify({ title: label, subtitle: project, message: bannerBody, sound: 'Glass' })
    return null
  }

  // Log only metadata, never the message text — it can contain secrets.
  log('info', 'showing reply prompt', { project, messageChars: message.length })

  // Fire a banner instead of a blocking dialog and defer to the in-terminal
  // prompt (don't steal focus — that would defeat the point). The body carries
  // the user's prompt line so you can tell which terminal is waiting. Title is
  // generic when you're focused (the question heuristic can fire on rhetorical
  // lines too); the explicit "waiting" wording is used when you're away. If no
  // notify backend is available the banner can't be shown and there's no
  // terminal fallback for a Stop nudge, so we fall through to the dialog.
  if (effectiveStyle === 'notify') {
    const banner = {
      title: isFront ? 'Claude needs your attention' : 'Claude is waiting for your input',
      subtitle: project,
      message: bannerBody,
      sound: 'Glass',
    }
    const shown = notify(banner)
    if (shown) {
      log('info', 'notify banner instead of reply dialog', { project, focused: isFront })
      return null
    }
    log('warn', 'notify mode but no banner backend; falling back to dialog', { project })
  }

  // If Claude listed enumerated choices, render a button per option. Picking one
  // injects it back so Claude answers itself; Open Claude / Dismiss still apply.
  const parsed = parseOptions(message)
  if (parsed) {
    const picked = showOptions({
      title: `Knowtify · Claude — ${project}`,
      heading: 'Claude is waiting for your reply',
      body: withTip(parsed.question || forDisplay(message)),
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
    body: withTip(`Claude is waiting for your reply:\n\n${forDisplay(message)}`),
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
