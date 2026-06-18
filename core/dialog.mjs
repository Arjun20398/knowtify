import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { getPlatformConfig } from './platform.mjs'

const DEFAULT_DIALOG_TIMEOUT = 300_000          // 5 min
const DEFAULT_INPUT_TIMEOUT  = 1_800_000        // 30 min — agent parks until you answer

// Marker an AppleScript prints when the user dismisses, distinct from empty input.
const MAC_CANCEL_SENTINEL = '@@KNOWTIFY_CANCEL@@'

/** @param {string} s @param {number} max */
function truncateLabel(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * Escape a value for safe embedding inside an AppleScript double-quoted string
 * literal. AppleScript treats `\` as an escape character, so backslashes MUST be
 * doubled before quotes are escaped — otherwise a value ending in `\` would
 * escape the closing quote and let following text leak into the string (or break
 * the script entirely). The dialog body is passed via a temp file and never goes
 * through here, but every other dynamic value (titles, button labels, list
 * options, notification text) does.
 * @param {unknown} s
 * @returns {string}
 */
function asLiteral(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Write `content` to a freshly-created, private temp file and hand back its path
 * plus a cleanup fn. We create a per-call directory via mkdtempSync (mode 0700)
 * and write the file with an exclusive (`wx`) handle at mode 0600. On a shared
 * /tmp (multi-user Linux) this defeats the classic predictable-name symlink /
 * TOCTOU attack — an attacker can neither pre-create the path nor read the
 * prompt body that's briefly staged there.
 * @param {string} content
 * @returns {{ file: string, cleanup: () => void } | null}
 */
function writeTempFile(content) {
  let dir
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtify-'))
    const file = path.join(dir, 'body.txt')
    fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return {
      file,
      cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} },
    }
  } catch {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
    return null
  }
}

/**
 * Did the child process fail to *run* (binary missing, killed, timed out), as
 * opposed to running and returning a non-zero status (which means the user
 * cancelled)? spawnSync sets `.error` and a null `.status` on failure.
 * @param {{ error?: unknown, status: number | null }} result
 */
function spawnFailed(result) {
  return Boolean(result.error) || result.status === null
}

// ──────────────────────────────────────────────────────────
// Confirm dialog: Allow / Allow-All / Deny
// Result is one of:
//   'allow' | 'allow-all' | 'deny'  → an actual user decision
//   'unavailable'                   → no GUI could be shown; caller should defer
// ──────────────────────────────────────────────────────────

/**
 * Show a native confirm dialog and return which action the user chose.
 *
 * @param {{
 *   title:          string,
 *   body:           string,
 *   allowLabel?:    string,
 *   denyLabel?:     string,
 *   allowAllLabel?: string | null,
 *   timeout?:       number,
 * }} opts
 * @param {{ run?: typeof spawnSync, platform?: import('./platform.mjs').PlatformConfig }} [deps]
 * @returns {{ result: 'allow' | 'allow-all' | 'deny' | 'unavailable', meta: Record<string, unknown> }}
 */
export function showDialog(opts, deps = {}) {
  const run = deps.run ?? spawnSync
  const cfg = deps.platform ?? getPlatformConfig()

  const o = {
    title:         opts.title,
    body:          opts.body,
    allowLabel:    opts.allowLabel    ?? 'Allow',
    denyLabel:     opts.denyLabel     ?? 'Deny',
    allowAllLabel: opts.allowAllLabel ?? null,
    timeout:       opts.timeout       ?? DEFAULT_DIALOG_TIMEOUT,
  }

  switch (cfg.dialog?.tool) {
    case 'osascript': return showDialogOsascript(o, run, cfg.dialog.path)
    case 'zenity':    return showDialogZenity(o, run, cfg.dialog.path)
    case 'kdialog':   return showDialogKdialog(o, run, cfg.dialog.path)
    default:
      return { result: 'unavailable', meta: { reason: 'no-dialog-tool', os: cfg.os } }
  }
}

/** macOS — AppleScript `display dialog`. @returns {{result: string, meta: object}} */
function showDialogOsascript(o, run, bin) {
  // Buttons render left-to-right; rightmost = default.
  const buttons = o.allowAllLabel
    ? [o.denyLabel, truncateLabel(o.allowAllLabel, 40), o.allowLabel]
    : [o.denyLabel, o.allowLabel]

  // Build the script from escaped literals, but compare against the *raw* labels
  // below — osascript returns the displayed (unescaped) button text.
  const btnScript   = buttons.map(b => `"${asLiteral(b)}"`).join(', ')
  const defaultBtn  = buttons.at(-1)
  const cancelBtn   = buttons[0]

  // Body via temp file to sidestep AppleScript quote-escaping.
  const tmp = writeTempFile(o.body)
  if (!tmp) return { result: 'unavailable', meta: { reason: 'tmpfile-write-failed' } }

  const script = `
set f to open for access POSIX file "${asLiteral(tmp.file)}"
set msg to read f as «class utf8»
close access f
set theResult to display dialog msg ¬
  buttons {${btnScript}} ¬
  default button "${asLiteral(defaultBtn)}" ¬
  cancel button "${asLiteral(cancelBtn)}" ¬
  with icon caution ¬
  with title "${asLiteral(o.title)}"
return button returned of theResult
`

  const result = run(bin, ['-e', script], { encoding: 'utf8', timeout: o.timeout })
  tmp.cleanup()

  const meta = {
    tool: 'osascript',
    status: result.status,
    signal: result.signal,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    defaultBtn,
    cancelBtn,
  }

  if (spawnFailed(result)) return { result: 'unavailable', meta: { ...meta, reason: 'osascript-unavailable' } }
  // Ran but errored (e.g. user hit the cancel button / Esc) → an explicit deny.
  if (result.status !== 0) return { result: 'deny', meta: { ...meta, reason: 'cancelled' } }

  const clicked = (result.stdout || '').trim()
  if (clicked === defaultBtn) return { result: 'allow', meta: { ...meta, clicked } }
  if (o.allowAllLabel && clicked === buttons.at(-2)) return { result: 'allow-all', meta: { ...meta, clicked } }
  return { result: 'deny', meta: { ...meta, clicked, reason: 'non-default-button' } }
}

/** Linux/GNOME — zenity `--question`. */
function showDialogZenity(o, run, bin) {
  const extraLabel = o.allowAllLabel ? truncateLabel(o.allowAllLabel, 40) : null
  const args = [
    '--question',
    `--title=${o.title}`,
    `--text=${o.body}`,
    `--ok-label=${o.allowLabel}`,
    `--cancel-label=${o.denyLabel}`,
  ]
  if (extraLabel) args.push(`--extra-button=${extraLabel}`)

  const result = run(bin, args, { encoding: 'utf8', timeout: o.timeout })
  const meta = { tool: 'zenity', status: result.status, stdout: (result.stdout || '').trim() }

  if (spawnFailed(result)) return { result: 'unavailable', meta: { ...meta, reason: 'zenity-unavailable' } }
  if (result.status === 0) return { result: 'allow', meta }
  // Non-zero: either Cancel/close (empty stdout) or the extra button (prints its label).
  const clicked = (result.stdout || '').trim()
  if (extraLabel && clicked === extraLabel) return { result: 'allow-all', meta: { ...meta, clicked } }
  return { result: 'deny', meta: { ...meta, clicked } }
}

/** Linux/KDE — kdialog. yes=0, no=1, cancel=2. */
function showDialogKdialog(o, run, bin) {
  const args = o.allowAllLabel
    ? ['--warningyesnocancel', o.body, '--title', o.title,
       '--yes-label', o.allowLabel, '--no-label', truncateLabel(o.allowAllLabel, 40), '--cancel-label', o.denyLabel]
    : ['--yesno', o.body, '--title', o.title,
       '--yes-label', o.allowLabel, '--no-label', o.denyLabel]

  const result = run(bin, args, { encoding: 'utf8', timeout: o.timeout })
  const meta = { tool: 'kdialog', status: result.status }

  if (spawnFailed(result)) return { result: 'unavailable', meta: { ...meta, reason: 'kdialog-unavailable' } }
  if (result.status === 0) return { result: 'allow', meta }
  if (o.allowAllLabel && result.status === 1) return { result: 'allow-all', meta }
  return { result: 'deny', meta }
}

// ──────────────────────────────────────────────────────────
// Input dialog: free-text reply.
// Returns the typed text, or null on dismiss / empty / unavailable.
// ──────────────────────────────────────────────────────────

/**
 * Show a native text-input dialog. Returns what the user typed, or null if they
 * dismissed/cancelled, submitted empty text, or no GUI was available.
 *
 * @param {{
 *   title:          string,
 *   body:           string,
 *   sendLabel?:     string,
 *   dismissLabel?:  string,
 *   defaultAnswer?: string,
 *   timeout?:       number,
 * }} opts
 * @param {{ run?: typeof spawnSync, platform?: import('./platform.mjs').PlatformConfig }} [deps]
 * @returns {{ text: string, meta: Record<string, unknown> } | null}
 */
export function showInputDialog(opts, deps = {}) {
  const run = deps.run ?? spawnSync
  const cfg = deps.platform ?? getPlatformConfig()

  const o = {
    title:         opts.title,
    body:          opts.body,
    sendLabel:     opts.sendLabel     ?? 'Send',
    dismissLabel:  opts.dismissLabel  ?? 'Dismiss',
    defaultAnswer: opts.defaultAnswer ?? '',
    timeout:       opts.timeout       ?? DEFAULT_INPUT_TIMEOUT,
  }

  switch (cfg.dialog?.tool) {
    case 'osascript': return showInputOsascript(o, run, cfg.dialog.path)
    case 'zenity':    return showInputZenity(o, run, cfg.dialog.path)
    case 'kdialog':   return showInputKdialog(o, run, cfg.dialog.path)
    default:          return null
  }
}

/**
 * macOS — an NSAlert with a scrollable NSTextView accessory (via AppleScriptObjC).
 * Unlike `display dialog`'s single-line field, this is a multi-line text area:
 * Return inserts a newline, the text wraps, and it scrolls once it overflows.
 */
function showInputOsascript(o, run, bin) {
  const safeTitle   = asLiteral(o.title)
  const safeSend    = asLiteral(o.sendLabel)
  const safeDismiss = asLiteral(o.dismissLabel)
  const safeDefault = asLiteral(o.defaultAnswer)

  const tmp = writeTempFile(o.body)
  if (!tmp) return null

  const script = `
use framework "Foundation"
use framework "AppKit"
use scripting additions
set bodyText to (read (POSIX file "${asLiteral(tmp.file)}") as «class utf8»)
set theApp to current application
set a to theApp's NSAlert's alloc()'s init()
a's setMessageText:"${safeTitle}"
a's setInformativeText:bodyText
(a's addButtonWithTitle:"${safeSend}")
(a's addButtonWithTitle:"${safeDismiss}")
set sv to theApp's NSScrollView's alloc()'s initWithFrame:(theApp's NSMakeRect(0, 0, 480, 150))
sv's setHasVerticalScroller:true
sv's setBorderType:(theApp's NSBezelBorder)
set tv to theApp's NSTextView's alloc()'s initWithFrame:(theApp's NSMakeRect(0, 0, 480, 150))
tv's setString:"${safeDefault}"
tv's setFont:(theApp's NSFont's systemFontOfSize:13)
tv's setRichText:false
tv's setAutomaticQuoteSubstitutionEnabled:false
sv's setDocumentView:tv
a's setAccessoryView:sv
a's window's setInitialFirstResponder:tv
theApp's NSApplication's sharedApplication()'s activateIgnoringOtherApps:true
set btn to a's runModal()
if btn is (theApp's NSAlertFirstButtonReturn) then
  return (tv's string() as text)
else
  return "${MAC_CANCEL_SENTINEL}"
end if
`

  const result = run(bin, ['-e', script], { encoding: 'utf8', timeout: o.timeout })
  tmp.cleanup()

  if (spawnFailed(result) || result.status !== 0) return null
  const out = (result.stdout || '').replace(/\n$/, '')
  if (out === MAC_CANCEL_SENTINEL) return null
  if (!out.trim()) return null
  return { text: out, meta: { tool: 'osascript', status: result.status } }
}

/** Linux/GNOME — zenity `--entry`. */
function showInputZenity(o, run, bin) {
  const args = ['--entry', `--title=${o.title}`, `--text=${o.body}`]
  if (o.defaultAnswer) args.push(`--entry-text=${o.defaultAnswer}`)

  const result = run(bin, args, { encoding: 'utf8', timeout: o.timeout })
  if (spawnFailed(result) || result.status !== 0) return null
  const text = (result.stdout || '').replace(/\n$/, '')
  if (!text.trim()) return null
  return { text, meta: { tool: 'zenity', status: result.status } }
}

/** Linux/KDE — kdialog `--textinputbox` (multi-line). */
function showInputKdialog(o, run, bin) {
  const args = ['--textinputbox', o.body, o.defaultAnswer, '--title', o.title]
  const result = run(bin, args, { encoding: 'utf8', timeout: o.timeout })
  if (spawnFailed(result) || result.status !== 0) return null
  const text = (result.stdout || '').replace(/\n$/, '')
  if (!text.trim()) return null
  return { text, meta: { tool: 'kdialog', status: result.status } }
}

// ──────────────────────────────────────────────────────────
// Notification: non-blocking banner (top-right on macOS, system
// notification area on Linux). Fire-and-forget.
// ──────────────────────────────────────────────────────────

/**
 * Show a non-blocking OS notification. Returns true if it was dispatched.
 *
 * @param {{ title: string, message?: string, subtitle?: string, sound?: string | null }} opts
 *   `sound` is a macOS sound name (e.g. "Glass"); pass null for silent.
 * @param {{ run?: typeof spawnSync, platform?: import('./platform.mjs').PlatformConfig }} [deps]
 * @returns {boolean}
 */
export function showNotification(opts, deps = {}) {
  const run = deps.run ?? spawnSync
  const cfg = deps.platform ?? getPlatformConfig()
  const title   = String(opts.title ?? '')
  const message = String(opts.message ?? '')
  const sound   = opts.sound === undefined ? 'Glass' : opts.sound

  try {
    switch (cfg.notify?.tool) {
      case 'osascript': {
        const t = asLiteral(title)
        const m = asLiteral(message)
        const sub = opts.subtitle ? ` subtitle "${asLiteral(opts.subtitle)}"` : ''
        const snd = sound ? ` sound name "${asLiteral(sound)}"` : ''
        const r = run(cfg.notify.path, ['-e', `display notification "${m}" with title "${t}"${sub}${snd}`], { encoding: 'utf8', timeout: 5000 })
        return !spawnFailed(r) && r.status === 0
      }
      case 'notify-send': {
        const args = [title, message]
        if (sound) args.push('-h', 'string:sound-name:complete')
        const r = run(cfg.notify.path, args, { encoding: 'utf8', timeout: 5000 })
        return !spawnFailed(r) && r.status === 0
      }
      case 'zenity': {
        const r = run(cfg.notify.path, ['--notification', `--text=${title}\n${message}`], { encoding: 'utf8', timeout: 5000 })
        return !spawnFailed(r) && r.status === 0
      }
      default:
        return false
    }
  } catch {
    return false
  }
}

// ──────────────────────────────────────────────────────────
// Choice dialog: pick one (radio) or many (checklist) from a list.
// Result is one of:
//   'ok'          → `selected` holds the chosen labels
//   'cancel'      → user dismissed
//   'unavailable' → no GUI backend
// ──────────────────────────────────────────────────────────

/**
 * Show a native single/multi-select list dialog.
 *
 * @param {{
 *   title:        string,
 *   body:         string,    // prompt text shown above the list
 *   options:      string[],  // selectable labels
 *   multiSelect?: boolean,
 *   sendLabel?:   string,
 *   dismissLabel?:string,
 *   timeout?:     number,
 * }} opts
 * @param {{ run?: typeof spawnSync, platform?: import('./platform.mjs').PlatformConfig }} [deps]
 * @returns {{ result: 'ok' | 'cancel' | 'unavailable', selected: string[], meta: Record<string, unknown> }}
 */
export function showChoiceDialog(opts, deps = {}) {
  const run = deps.run ?? spawnSync
  const cfg = deps.platform ?? getPlatformConfig()

  const o = {
    title:        opts.title,
    body:         opts.body,
    options:      Array.isArray(opts.options) ? opts.options : [],
    multiSelect:  Boolean(opts.multiSelect),
    sendLabel:    opts.sendLabel    ?? 'Send',
    dismissLabel: opts.dismissLabel ?? 'Dismiss',
    timeout:      opts.timeout      ?? DEFAULT_INPUT_TIMEOUT,
  }

  if (!o.options.length) return { result: 'cancel', selected: [], meta: { reason: 'no-options' } }

  switch (cfg.dialog?.tool) {
    case 'osascript': return showChoiceOsascript(o, run, cfg.dialog.path)
    case 'zenity':    return showChoiceZenity(o, run, cfg.dialog.path)
    case 'kdialog':   return showChoiceKdialog(o, run, cfg.dialog.path)
    default:          return { result: 'unavailable', selected: [], meta: { reason: 'no-dialog-tool', os: cfg.os } }
  }
}

/** macOS — AppleScript `choose from list`. */
function showChoiceOsascript(o, run, bin) {
  // Build the list literal from escaped options; the raw labels are what
  // osascript returns and what callers match against downstream.
  const items = o.options.map(s => `"${asLiteral(s)}"`).join(', ')
  const safeTitle   = asLiteral(o.title)
  const safeSend    = asLiteral(o.sendLabel)
  const safeDismiss = asLiteral(o.dismissLabel)
  const multi = o.multiSelect ? 'true' : 'false'

  const tmp = writeTempFile(o.body)
  if (!tmp) return { result: 'unavailable', selected: [], meta: { reason: 'tmpfile-write-failed' } }

  const script = `
set f to open for access POSIX file "${asLiteral(tmp.file)}"
set msg to read f as «class utf8»
close access f
set AppleScript's text item delimiters to linefeed
set chosen to choose from list {${items}} with title "${safeTitle}" with prompt msg OK button name "${safeSend}" cancel button name "${safeDismiss}" multiple selections allowed ${multi}
if chosen is false then
  return "${MAC_CANCEL_SENTINEL}"
end if
return chosen as text
`

  const result = run(bin, ['-e', script], { encoding: 'utf8', timeout: o.timeout })
  tmp.cleanup()

  const meta = { tool: 'osascript', status: result.status, stderr: (result.stderr || '').trim() }
  if (spawnFailed(result)) return { result: 'unavailable', selected: [], meta: { ...meta, reason: 'osascript-unavailable' } }
  if (result.status !== 0) return { result: 'cancel', selected: [], meta }

  const out = (result.stdout || '').replace(/\n$/, '')
  if (out === MAC_CANCEL_SENTINEL) return { result: 'cancel', selected: [], meta }
  const selected = out.split('\n').map(s => s.trim()).filter(Boolean)
  if (!selected.length) return { result: 'cancel', selected: [], meta }
  return { result: 'ok', selected, meta }
}

/** Linux/GNOME — zenity `--list --radiolist/--checklist`. */
function showChoiceZenity(o, run, bin) {
  const args = [
    '--list',
    o.multiSelect ? '--checklist' : '--radiolist',
    `--title=${o.title}`,
    `--text=${o.body}`,
    '--separator=\n',
    '--hide-header',
    '--column=', '--column=Option',
    // Column 1 is the toggle; print column 2 (the label) for the selected rows,
    // otherwise zenity returns "TRUE" instead of the chosen option.
    '--print-column=2',
  ]
  o.options.forEach((label, i) => {
    args.push(o.multiSelect ? 'FALSE' : (i === 0 ? 'TRUE' : 'FALSE'), label)
  })

  const result = run(bin, args, { encoding: 'utf8', timeout: o.timeout })
  const meta = { tool: 'zenity', status: result.status }
  if (spawnFailed(result)) return { result: 'unavailable', selected: [], meta: { ...meta, reason: 'zenity-unavailable' } }
  if (result.status !== 0) return { result: 'cancel', selected: [], meta }

  const selected = (result.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
  if (!selected.length) return { result: 'cancel', selected: [], meta }
  return { result: 'ok', selected, meta }
}

/** Linux/KDE — kdialog `--radiolist/--checklist --separate-output`. */
function showChoiceKdialog(o, run, bin) {
  const args = ['--separate-output', o.multiSelect ? '--checklist' : '--radiolist', o.body]
  o.options.forEach((label, i) => {
    args.push(label, label, !o.multiSelect && i === 0 ? 'on' : 'off')
  })
  args.push('--title', o.title)

  const result = run(bin, args, { encoding: 'utf8', timeout: o.timeout })
  const meta = { tool: 'kdialog', status: result.status }
  if (spawnFailed(result)) return { result: 'unavailable', selected: [], meta: { ...meta, reason: 'kdialog-unavailable' } }
  if (result.status !== 0) return { result: 'cancel', selected: [], meta }

  const selected = (result.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
  if (!selected.length) return { result: 'cancel', selected: [], meta }
  return { result: 'ok', selected, meta }
}
