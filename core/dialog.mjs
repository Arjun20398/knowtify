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

// A soft "this just popped up" cue — quiet enough to register as a UI tick, not
// an alarm. Plays the instant any Knowtify dialog appears.
const POPUP_SOUND = 'Tink'
const POPUP_SOUND_VOLUME = 0.25

// Notification banners ring their sound at full system volume via the OS, with
// no per-call attenuation. So instead of `display notification`'s `sound name`,
// we play the cue ourselves (afplay) at half volume — a softer nudge.
const NOTIFY_SOUND_VOLUME = 0.5

/**
 * AppleScriptObjC lines that play the popup sound — for scripts that already
 * `use framework "AppKit"` (NSAlert dialogs). `play()` returns immediately so
 * the chime rings while the modal blocks. Requires `theApp` in scope.
 * @returns {string}
 */
function macSoundObjC() {
  return `set _snd to (theApp's NSSound's soundNamed:"${POPUP_SOUND}")
if _snd is not missing value then
  (_snd's setVolume:${POPUP_SOUND_VOLUME})
  (_snd's play())
end if`
}

/**
 * A StandardAdditions line that plays the popup sound for plain AppleScript
 * (`display dialog`) where no Cocoa frameworks are loaded. Backgrounded with `&`
 * so it never blocks the dialog from showing.
 * @returns {string}
 */
function macSoundShell() {
  return `do shell script "afplay -v ${POPUP_SOUND_VOLUME} /System/Library/Sounds/${POPUP_SOUND}.aiff >/dev/null 2>&1 &"`
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
${macSoundShell()}
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
// Options dialog: one button per parsed option, plus two fixed
// trailing buttons (e.g. Open Claude / Dismiss).
// Result is one of:
//   { result: 'option', index, label } → user picked options[index]
//   { result: 'open' }                 → trailing primary button
//   { result: 'dismiss' }              → trailing secondary button / cancel
//   { result: 'unavailable' }          → no GUI / unsupported backend
// ──────────────────────────────────────────────────────────

/**
 * Show a dialog with a button for each option plus two trailing buttons.
 * Currently macOS-only (NSAlert); other backends return 'unavailable' so the
 * caller can fall back to a plain two-button dialog.
 *
 * @param {{
 *   title:         string,
 *   heading?:      string,
 *   body?:         string,
 *   options:       string[],
 *   openLabel?:    string,
 *   dismissLabel?: string,
 *   sound?:        string | null,
 *   timeout?:      number,
 * }} opts
 * @param {{ run?: typeof spawnSync, platform?: import('./platform.mjs').PlatformConfig }} [deps]
 * @returns {{ result: 'option' | 'open' | 'dismiss' | 'unavailable', index?: number, label?: string, meta: Record<string, unknown> }}
 */
export function showOptionsDialog(opts, deps = {}) {
  const run = deps.run ?? spawnSync
  const cfg = deps.platform ?? getPlatformConfig()

  const o = {
    title:        opts.title,
    heading:      opts.heading ?? opts.title,
    body:         opts.body ?? '',
    options:      Array.isArray(opts.options) ? opts.options : [],
    openLabel:    opts.openLabel ?? 'Open Claude',
    dismissLabel: opts.dismissLabel ?? 'Dismiss',
    sound:        opts.sound === undefined ? 'Tink' : opts.sound,
    timeout:      opts.timeout ?? DEFAULT_DIALOG_TIMEOUT,
  }

  if (!o.options.length) return { result: 'unavailable', meta: { reason: 'no-options' } }

  switch (cfg.dialog?.tool) {
    case 'osascript': return showOptionsOsascript(o, run, cfg.dialog.path)
    default:          return { result: 'unavailable', meta: { reason: 'unsupported-backend', os: cfg.os } }
  }
}

/**
 * macOS — an NSAlert whose buttons are: each option (in order), then the Open
 * and Dismiss buttons. Buttons map to NSModalResponse codes by add order
 * (First=1000, Second=1001, …), which we translate back to an option index.
 * @returns {{result: string, index?: number, label?: string, meta: object}}
 */
function showOptionsOsascript(o, run, bin) {
  const bodyTmp = writeTempFile(o.body)
  if (!bodyTmp) return { result: 'unavailable', meta: { reason: 'tmpfile-write-failed' } }

  const heading = asLiteral(o.heading)
  const optButtons = o.options
    .map(label => `(a's addButtonWithTitle:"${asLiteral(truncateLabel(label, 60))}")`)
    .join('\n')
  const openIdx = o.options.length // add-order index of the Open button

  // Read the body via NSString, not StandardAdditions `read (POSIX file …)`:
  // once `use framework "Foundation"` is active, that form throws -1700 ("Can't
  // make current application into type file") and aborts the dialog.
  const script = `
use framework "Foundation"
use framework "AppKit"
set theApp to current application
set bodyText to ((theApp's NSString's stringWithContentsOfFile:"${asLiteral(bodyTmp.file)}" encoding:(theApp's NSUTF8StringEncoding) |error|:(missing value)) as text)
set a to theApp's NSAlert's alloc()'s init()
a's setMessageText:"${heading}"
a's setInformativeText:bodyText
${optButtons}
(a's addButtonWithTitle:"${asLiteral(o.openLabel)}")
(a's addButtonWithTitle:"${asLiteral(o.dismissLabel)}")
${macSoundObjC()}
theApp's NSApplication's sharedApplication()'s activateIgnoringOtherApps:true
set btn to a's runModal()
return (btn as text)
`

  const result = run(bin, ['-e', script], { encoding: 'utf8', timeout: o.timeout })
  bodyTmp.cleanup()

  const rawOut = (result.stdout || '').trim()
  const rc = parseInt(rawOut, 10)
  const meta = {
    tool: 'osascript',
    status: result.status,
    rc: Number.isNaN(rc) ? null : rc,
    stdout: rawOut,
    stderr: (result.stderr || '').trim(),
  }

  if (spawnFailed(result)) return { result: 'unavailable', meta: { ...meta, reason: 'osascript-unavailable' } }
  if (result.status !== 0) return { result: 'dismiss', meta: { ...meta, reason: 'cancelled' } }

  const idx = rc - 1000 // 0-based button index, in add order
  if (idx >= 0 && idx < o.options.length) return { result: 'option', index: idx, label: o.options[idx], meta }
  if (idx === openIdx) return { result: 'open', meta }
  return { result: 'dismiss', meta }
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
${macSoundObjC()}
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
  const title    = String(opts.title ?? '')
  const message  = String(opts.message ?? '')
  const subtitle = opts.subtitle ? String(opts.subtitle) : ''
  const sound    = opts.sound === undefined ? 'Glass' : opts.sound

  // macOS has a dedicated subtitle field; Linux backends don't, so fold the
  // subtitle into the body there (newline-joined) rather than dropping it.
  const linuxBody = [subtitle, message].filter(Boolean).join('\n')

  try {
    switch (cfg.notify?.tool) {
      case 'osascript': {
        const t = asLiteral(title)
        const m = asLiteral(message)
        const sub = subtitle ? ` subtitle "${asLiteral(subtitle)}"` : ''
        const eArgs = ['-e', `display notification "${m}" with title "${t}"${sub}`]
        // Play the cue ourselves at reduced volume (backgrounded with & so it
        // never delays the banner). For any non-standard sound name we can't map
        // to a system .aiff, fall back to the OS's full-volume `sound name`.
        if (sound && /^[A-Za-z]+$/.test(sound)) {
          eArgs.push('-e', `do shell script "afplay -v ${NOTIFY_SOUND_VOLUME} /System/Library/Sounds/${sound}.aiff >/dev/null 2>&1 &"`)
        } else if (sound) {
          eArgs[1] += ` sound name "${asLiteral(sound)}"`
        }
        const r = run(cfg.notify.path, eArgs, { encoding: 'utf8', timeout: 5000 })
        return !spawnFailed(r) && r.status === 0
      }
      case 'notify-send': {
        const args = [title, linuxBody]
        if (sound) args.push('-h', 'string:sound-name:complete')
        const r = run(cfg.notify.path, args, { encoding: 'utf8', timeout: 5000 })
        return !spawnFailed(r) && r.status === 0
      }
      case 'zenity': {
        const r = run(cfg.notify.path, ['--notification', `--text=${[title, linuxBody].filter(Boolean).join('\n')}`], { encoding: 'utf8', timeout: 5000 })
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

/**
 * macOS — an NSAlert whose accessory is a bordered, scrollable list of option
 * rows: radio buttons for single-select, checkboxes for multi-select, with a
 * hairline divider between each row so every option has a visible boundary
 * (the native `choose from list` shows no row separators until you click).
 * Returns the checked option labels (newline-joined) or a cancel sentinel — the
 * same stdout contract the caller already parses.
 *
 * Button-type / box-type constants are passed as integers because the enum
 * names aren't reliably exposed to AppleScriptObjC:
 *   NSButtonTypeRadio = 4, NSButtonTypeSwitch = 3, NSBoxSeparator = 2.
 */
function showChoiceOsascript(o, run, bin) {
  // The raw labels are what we return and what callers match against downstream.
  const titlesList  = o.options.map(s => `"${asLiteral(s)}"`).join(', ')
  const safeTitle   = asLiteral(o.title)
  const safeSend    = asLiteral(o.sendLabel)
  const safeDismiss = asLiteral(o.dismissLabel)
  const buttonType  = o.multiSelect ? 3 : 4 // switch (checkbox) : radio
  // Single-select needs explicit exclusivity: NSButton radios don't auto-group
  // in AppleScriptObjC, so each radio targets a handler that clears its siblings.
  const radioWiring = o.multiSelect ? '' : `
  (b's setTarget:me)
  (b's setAction:"radioPicked:")`

  const tmp = writeTempFile(o.body)
  if (!tmp) return { result: 'unavailable', selected: [], meta: { reason: 'tmpfile-write-failed' } }

  const script = `
use framework "Foundation"
use framework "AppKit"
global btns
set theApp to current application
set bodyText to ((theApp's NSString's stringWithContentsOfFile:"${asLiteral(tmp.file)}" encoding:(theApp's NSUTF8StringEncoding) |error|:(missing value)) as text)
set optTitles to {${titlesList}}
set n to (count of optTitles)
set rowH to 32
set w to 460
set totalH to n * rowH
set container to theApp's NSView's alloc()'s initWithFrame:(theApp's NSMakeRect(0, 0, w, totalH))
set btns to {}
repeat with i from 1 to n
  set topY to totalH - (i * rowH)
  set b to theApp's NSButton's alloc()'s initWithFrame:(theApp's NSMakeRect(14, topY + 4, w - 28, rowH - 8))
  (b's setButtonType:${buttonType})
  (b's setTitle:(item i of optTitles))
  (b's setFont:(theApp's NSFont's systemFontOfSize:13))${radioWiring}
  (container's addSubview:b)
  set end of btns to b
  if i < n then
    set sep to theApp's NSBox's alloc()'s initWithFrame:(theApp's NSMakeRect(8, topY, w - 16, 1))
    (sep's setBoxType:2)
    (container's addSubview:sep)
  end if
end repeat
set visH to totalH
if visH > 300 then set visH to 300
set sv to theApp's NSScrollView's alloc()'s initWithFrame:(theApp's NSMakeRect(0, 0, w, visH))
(sv's setHasVerticalScroller:true)
(sv's setBorderType:(theApp's NSBezelBorder))
(sv's setDrawsBackground:false)
(sv's setDocumentView:container)
set a to theApp's NSAlert's alloc()'s init()
a's setMessageText:"${safeTitle}"
a's setInformativeText:bodyText
a's setAccessoryView:sv
(a's addButtonWithTitle:"${safeSend}")
(a's addButtonWithTitle:"${safeDismiss}")
${macSoundObjC()}
theApp's NSApplication's sharedApplication()'s activateIgnoringOtherApps:true
set btn to a's runModal()
if btn is not (theApp's NSAlertFirstButtonReturn) then
  return "${MAC_CANCEL_SENTINEL}"
end if
set chosen to {}
repeat with b in btns
  if ((b's state()) as integer) is 1 then set end of chosen to (b's title() as text)
end repeat
set AppleScript's text item delimiters to linefeed
return (chosen as text)

on radioPicked:sender
  global btns
  repeat with bb in btns
    if ((bb's isEqual:sender) as boolean) is false then (bb's setState:0)
  end repeat
end radioPicked:
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
