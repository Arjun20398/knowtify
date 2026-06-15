import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { PENDING_DIR, RESPONSES_DIR } from '../paths.mjs'

// ──────────────────────────────────────────────────────────
// ID helpers
// ──────────────────────────────────────────────────────────

/** @param {Record<string, unknown>} input */
export function buildRequestId(input) {
  const sessionId = String(input.session_id || 'unknown')
  const tool = String(input.tool_name || 'tool')
  const cmd = JSON.stringify(input.tool_input || {})
  const hash = crypto.createHash('sha1').update(cmd).digest('hex').slice(0, 8)
  return `${sessionId}:${tool}:${hash}`
}

// ──────────────────────────────────────────────────────────
// Choices
// ──────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────
// Prompt builder
// ──────────────────────────────────────────────────────────

/** @param {Record<string, unknown>} input */
export function buildPendingPrompt(input) {
  const requestId = buildRequestId(input)
  const toolInput = /** @type {Record<string, unknown>} */ (input.tool_input || {})
  const project = path.basename(String(input.cwd || 'unknown'))
  const choices = buildChoices(input)

  const lines = [`${String(input.tool_name || 'Tool')} command`, '']
  if (toolInput.command) lines.push(String(toolInput.command))
  if (toolInput.description) lines.push(String(toolInput.description))
  if (toolInput.file_path) lines.push(String(toolInput.file_path))
  lines.push('', 'Do you want to proceed?')
  choices.forEach((c, i) => lines.push(`${i + 1}. ${c.label}`))

  return {
    id: requestId,
    tool: 'claude',
    project,
    summary: lines.join('\n'),
    toolName: String(input.tool_name || ''),
    command: toolInput.command ? String(toolInput.command) : undefined,
    description: toolInput.description ? String(toolInput.description) : undefined,
    sessionId: String(input.session_id || ''),
    cwd: String(input.cwd || ''),
    responderType: 'permission-request',
    waitingSince: Date.now(),
    choices,
    hookInput: input,
  }
}

// ──────────────────────────────────────────────────────────
// Pending / response files (kept for daemon compat)
// ──────────────────────────────────────────────────────────

/** @param {ReturnType<typeof buildPendingPrompt>} prompt */
export function writePending(prompt) {
  fs.mkdirSync(PENDING_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(PENDING_DIR, `${prompt.id}.json`),
    JSON.stringify(prompt, null, 2) + '\n',
  )
}

/** @param {string} requestId */
export function clearPending(requestId) {
  try { fs.unlinkSync(path.join(PENDING_DIR, `${requestId}.json`)) } catch { /* ignore */ }
  try { fs.unlinkSync(path.join(RESPONSES_DIR, `${requestId}.json`)) } catch { /* ignore */ }
}

// ──────────────────────────────────────────────────────────
// Hook response builder
// ──────────────────────────────────────────────────────────

/**
 * @param {ReturnType<typeof buildPendingPrompt>} prompt
 * @param {string} action  'yes' | 'yes-all' | 'no'
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
    if (suggestions.length > 0) {
      decision.updatedPermissions = [suggestions[0]]
    } else {
      decision.updatedPermissions = [
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      ]
    }
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision,
    },
  }
}

// ──────────────────────────────────────────────────────────
// macOS dialog (primary UI — no notification permission needed)
// ──────────────────────────────────────────────────────────

/**
 * Show a native macOS "display dialog" and return which button the user clicked.
 * Writes the message to a temp file to avoid AppleScript string-escaping issues.
 *
 * @param {ReturnType<typeof buildPendingPrompt>} prompt
 * @returns {'yes' | 'yes-all' | 'no'}
 */
function showDialog(prompt) {
  const toolInput = /** @type {Record<string, unknown>} */ (prompt.hookInput?.tool_input || {})

  const lines = []
  if (toolInput.command)     lines.push(`$ ${String(toolInput.command)}`)
  if (toolInput.description) lines.push(String(toolInput.description))
  if (toolInput.file_path)   lines.push(String(toolInput.file_path))
  const detail = lines.join('\n') || String(prompt.toolName || 'Unknown tool')

  // Short label for "Allow All" button — AppleScript buttons must be <= 255 chars
  const allowAllChoice = prompt.choices.find(c => c.id === 'yes-all')
  const allowAllLabel  = truncateLabel(allowAllChoice?.label || 'Allow All', 40)

  const message = `Claude wants to run:\n\n${detail}\n\nProject: ${prompt.project}`

  // Write message to a temp file so we never have AppleScript quote-escaping issues
  const tmpFile = path.join(os.tmpdir(), `knowtify-${Date.now()}.txt`)
  try {
    fs.writeFileSync(tmpFile, message, 'utf8')
  } catch {
    return 'no'
  }

  const safeAllowAll = allowAllLabel.replace(/"/g, '')
  const script = `
set f to open for access POSIX file "${tmpFile}"
set msg to read f as «class utf8»
close access f
set theResult to display dialog msg ¬
  buttons {"No", "${safeAllowAll}", "Yes"} ¬
  default button "Yes" ¬
  cancel button "No" ¬
  with icon caution ¬
  with title "Knowtify · Claude"
return button returned of theResult
`

  const result = spawnSync('/usr/bin/osascript', ['-e', script], {
    encoding: 'utf8',
    timeout: 300_000, // 5 min
  })

  try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }

  if (result.status !== 0) {
    // User clicked "No" / pressed Escape / closed dialog
    return 'no'
  }

  const button = (result.stdout || '').trim()
  if (button === 'Yes')         return 'yes'
  if (button === safeAllowAll)  return 'yes-all'
  return 'no'
}

/** @param {string} s @param {number} max */
function truncateLabel(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// ──────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────

/**
 * Handle a PermissionRequest hook payload. Blocks until user responds.
 * Uses a native macOS dialog — no notification permission required.
 *
 * @param {Record<string, unknown>} input
 */
export async function handlePermissionRequest(input) {
  const prompt = buildPendingPrompt(input)
  writePending(prompt)

  try {
    const action = showDialog(prompt)
    return buildHookOutput(prompt, action)
  } finally {
    clearPending(prompt.id)
  }
}
