import crypto from 'crypto'
import path from 'path'
import { showDialog, showChoiceDialog, showNotification } from '../../core/dialog.mjs'
import { isHostAppFrontmost, focusHostApp } from '../../core/focus.mjs'
import { getConfig } from '../../core/config.mjs'
import { withTip, NOTIFY_TIP } from './tips.mjs'

// Synthetic choice for "none of these — I want to type my own answer". Picking
// it hands the question back to Claude's own window (we don't capture free text
// in a cramped dialog), so we focus that window and defer.
const OTHER_LABEL = '✎ Other (let me type in Claude)…'

// ──────────────────────────────────────────────────────────
// Pure transformers (no side effects → trivially testable)
// ──────────────────────────────────────────────────────────

/** Stable id for a request: `session:tool:hash8`. @param {Record<string, unknown>} input */
export function buildRequestId(input) {
  const sessionId = String(input.session_id || 'unknown')
  const tool = String(input.tool_name || 'tool')
  const cmd = JSON.stringify(input.tool_input || {})
  const hash = crypto.createHash('sha1').update(cmd).digest('hex').slice(0, 8)
  return `${sessionId}:${tool}:${hash}`
}

/** @param {Record<string, unknown>} input */
export function buildChoices(input) {
  const suggestions = /** @type {Record<string, unknown>[]} */ (
    input.permission_suggestions || []
  )

  const choices = [{ id: 'yes', label: 'Yes', action: 'yes' }]

  if (suggestions.length > 0) {
    const s = suggestions[0]
    const rules = /** @type {Record<string, unknown>[]} */ (s.rules || [])
    const rule = rules[0]
    const ruleContent = rule?.ruleContent ? String(rule.ruleContent) : ''
    const dest = s.destination === 'localSettings' ? 'this project' : String(s.destination || 'session')
    const label = ruleContent
      ? `Yes, allow ${ruleContent} from ${dest}`
      : `Yes, allow ${String(input.tool_name || 'tool')} from ${dest}`
    choices.push({ id: 'yes-all', label, action: 'yes-all' })
  } else {
    choices.push({ id: 'yes-all', label: 'Yes, allow all for this session', action: 'yes-all' })
  }

  choices.push({ id: 'no', label: 'No', action: 'no' })
  return choices
}

/** @param {Record<string, unknown>} input */
export function buildPrompt(input) {
  const toolInput = /** @type {Record<string, unknown>} */ (input.tool_input || {})
  const project = path.basename(String(input.cwd || 'unknown'))
  const choices = buildChoices(input)

  const lines = []
  if (toolInput.command)     lines.push(`$ ${String(toolInput.command)}`)
  if (toolInput.description) lines.push(String(toolInput.description))
  if (toolInput.file_path)   lines.push(String(toolInput.file_path))
  const detail = lines.join('\n') || String(input.tool_name || 'Unknown tool')

  return {
    id: buildRequestId(input),
    project,
    detail,
    toolName: String(input.tool_name || ''),
    command: toolInput.command ? String(toolInput.command) : undefined,
    choices,
    hookInput: input,
  }
}

/**
 * Map a chosen action to the JSON the Claude PermissionRequest hook must emit.
 * @param {ReturnType<typeof buildPrompt>} prompt
 * @param {'yes' | 'yes-all' | 'no'} action
 */
export function buildHookOutput(prompt, action) {
  if (action === 'no') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Denied via Knowtify' },
      },
    }
  }

  const decision = { behavior: 'allow' }

  if (action === 'yes-all') {
    const suggestions = /** @type {Record<string, unknown>[]} */ (
      prompt.hookInput.permission_suggestions || []
    )
    decision.updatedPermissions = suggestions.length > 0
      ? [suggestions[0]]
      : [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
  }

  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }
}

// ──────────────────────────────────────────────────────────
// Orchestrator (side effects injected → testable without a GUI)
// ──────────────────────────────────────────────────────────

/**
 * Handle a PermissionRequest payload. Blocks on a native dialog unless the
 * Claude window is already frontmost (then defers to the in-terminal prompt).
 *
 * @param {Record<string, unknown>} input
 * @param {{
 *   showDialog?: typeof showDialog,
 *   showChoiceDialog?: typeof showChoiceDialog,
 *   showNotification?: typeof showNotification,
 *   focusHostApp?: typeof focusHostApp,
 *   isHostAppFrontmost?: typeof isHostAppFrontmost,
 *   config?: import('../../core/config.mjs').Config,
 * }} [deps]
 * @returns {Promise<object | null>} hook output, or null to defer to Claude
 */
export async function handlePermissionRequest(input, deps = {}) {
  // AskUserQuestion isn't a yes/no permission — it's a multiple-choice question.
  // Render it as a real choice dialog and answer it inline.
  if (String(input.tool_name) === 'AskUserQuestion') {
    return handleAskUserQuestion(input, deps)
  }

  const show = deps.showDialog ?? showDialog
  const frontmost = deps.isHostAppFrontmost ?? isHostAppFrontmost
  const config = deps.config ?? getConfig()

  // 'always' notifies even when the host app is frontmost (e.g. a background
  // terminal tab in the same window); 'unfocused' (default) stays quiet then.
  const isFront = frontmost()
  if (config.notifyWhen !== 'always' && isFront) return null

  // Notify mode (or focused, where a modal would interrupt you): a banner can't
  // carry an Allow/Deny action, so we can't approve from it. Announce that
  // Claude needs a decision and defer to the in-terminal permission prompt (same
  // outcome as having no GUI backend — never auto-deny). When focused we drop
  // the cross-promo tip — there's no dialog to switch to when you're right here.
  if (isFront || config.style === 'notify') {
    const notify = deps.showNotification ?? showNotification
    const project = path.basename(String(input.cwd || 'unknown'))
    // Non-empty body required for macOS to render the banner (the tip is dropped
    // when focused, so the project name is the body instead).
    notify(isFront
      ? { title: 'Claude needs your permission', message: project, sound: 'Glass' }
      : { title: 'Claude needs your permission', subtitle: project, message: NOTIFY_TIP, sound: 'Glass' })
    return null
  }

  const prompt = buildPrompt(input)
  const allowAllChoice = prompt.choices.find(c => c.id === 'yes-all')

  const { result } = show({
    title:         'Knowtify · Claude',
    body:          withTip(`Claude wants to run:\n\n${prompt.detail}\n\nProject: ${prompt.project}`),
    allowLabel:    'Yes',
    denyLabel:     'No',
    allowAllLabel: allowAllChoice?.label || 'Allow All',
  })

  // No GUI backend on this platform → defer to Claude's own in-terminal prompt
  // rather than silently denying the tool.
  if (result === 'unavailable') return null

  // The dialog auto-dismissed because you returned to the terminal/editor. Defer
  // to Claude's in-terminal prompt — never treat a refocus as a deny.
  if (result === 'refocus') return null

  const action = result === 'allow' ? 'yes' : result === 'allow-all' ? 'yes-all' : 'no'
  return buildHookOutput(prompt, action)
}

// ──────────────────────────────────────────────────────────
// AskUserQuestion — multiple-choice questions answered inline
// ──────────────────────────────────────────────────────────

/**
 * Render the prompt body for one question: the question text followed by each
 * option and its description (the list dialog only shows the bare labels).
 * @param {Record<string, unknown>} q
 */
export function buildQuestionBody(q) {
  const lines = [String(q.question || '').trim(), '']
  const options = Array.isArray(q.options) ? q.options : []
  for (const o of options) {
    const label = String(o?.label ?? '').trim()
    if (!label) continue
    const desc = String(o?.description ?? '').trim()
    lines.push(desc ? `• ${label} — ${desc}` : `• ${label}`)
  }
  if (q.multiSelect) lines.push('', '(select one or more)')
  return lines.join('\n').trim()
}

/**
 * Build the answers map Claude expects: question text → chosen label(s).
 * Multi-select labels are comma-joined. Returns null to signal "defer to
 * Claude's own window" when any question is dismissed, has no GUI, or the user
 * picks "Other" (i.e. wants to type a free-form reply in Claude itself).
 *
 * @param {Record<string, unknown>[]} questions
 * @param {{ showChoiceDialog: typeof showChoiceDialog, header: string }} io
 * @returns {Record<string, string> | null}
 */
export function collectAnswers(questions, io) {
  const answers = {}

  for (const q of questions) {
    const qText = String(q.question || '')
    const header = String(q.header || io.header)
    const options = (Array.isArray(q.options) ? q.options : [])
      .map(o => String(o?.label ?? '').trim())
      .filter(Boolean)
    if (!options.length) return null

    const { result, selected } = io.showChoiceDialog({
      title: `Knowtify · Claude — ${header}`,
      body: withTip(buildQuestionBody(q)),
      options: [...options, OTHER_LABEL],
      multiSelect: Boolean(q.multiSelect),
    })

    if (result !== 'ok') return null            // unavailable or dismissed → defer
    if (selected.includes(OTHER_LABEL)) return null // wants to type → defer to Claude's window
    if (!selected.length) return null

    answers[qText] = selected.join(', ')
  }

  return answers
}

/**
 * Handle an AskUserQuestion permission request: show each question as a choice
 * dialog and answer it via `updatedInput` so Claude continues without a terminal
 * prompt. When the user dismisses, no GUI is available, or they pick "Other"
 * (wanting to type their own reply), we focus the Claude window and defer so
 * they can answer in Claude's native UI.
 *
 * @param {Record<string, unknown>} input
 * @param {{
 *   showChoiceDialog?: typeof showChoiceDialog,
 *   showNotification?: typeof showNotification,
 *   focusHostApp?: typeof focusHostApp,
 *   isHostAppFrontmost?: typeof isHostAppFrontmost,
 *   config?: import('../../core/config.mjs').Config,
 * }} [deps]
 * @returns {object | null}
 */
export function handleAskUserQuestion(input, deps = {}) {
  const showChoice = deps.showChoiceDialog ?? showChoiceDialog
  const focus      = deps.focusHostApp ?? focusHostApp
  const frontmost  = deps.isHostAppFrontmost ?? isHostAppFrontmost
  const config     = deps.config ?? getConfig()

  const isFront = frontmost()
  if (config.notifyWhen !== 'always' && isFront) return null

  const toolInput = /** @type {Record<string, unknown>} */ (input.tool_input || {})
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : []
  if (!questions.length) return null

  const header = path.basename(String(input.cwd || 'unknown'))

  // Notify mode (or focused, where a choice modal would interrupt you): skip the
  // choice dialog, fire a banner, and let Claude's own picker handle it inline.
  // When focused, keep it plain — generic title, no cross-promo tip.
  if (isFront || config.style === 'notify') {
    const notify = deps.showNotification ?? showNotification
    notify(isFront
      ? { title: 'Claude needs your attention', message: header, sound: 'Glass' }
      : { title: 'Claude is waiting for your input', subtitle: header, message: NOTIFY_TIP, sound: 'Glass' })
    return null
  }

  const answers = collectAnswers(questions, { showChoiceDialog: showChoice, header })
  if (!answers) {
    // Dismissed, no GUI, or "Other" → let Claude's own picker handle it and jump
    // the user to that window.
    focus()
    return null
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'allow',
        updatedInput: { ...toolInput, questions, answers },
      },
    },
  }
}
