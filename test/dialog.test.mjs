import { test } from 'node:test'
import assert from 'node:assert/strict'
import { showDialog, showInputDialog, showChoiceDialog, showNotification } from '../core/dialog.mjs'
import { isHostAppFrontmost, focusHostApp } from '../core/focus.mjs'

const osa = { tool: 'osascript', path: '/usr/bin/osascript' }
const MAC = { os: 'macos', dialog: osa, notify: osa, focus: osa }
const ZENITY = { os: 'linux', dialog: { tool: 'zenity', path: '/usr/bin/zenity' }, notify: { tool: 'notify-send', path: '/usr/bin/notify-send' }, focus: { tool: 'xdotool', path: '/usr/bin/xdotool' } }
const KDIALOG = { os: 'linux', dialog: { tool: 'kdialog', path: '/usr/bin/kdialog' }, notify: null, focus: null }
const HEADLESS = { os: 'linux', dialog: null, notify: null, focus: null }

const ok = (over) => ({ status: 0, signal: null, stdout: '', stderr: '', ...over })

// ── dialog dispatch ──
const opts = { title: 'T', body: 'B', allowLabel: 'Yes', denyLabel: 'No', allowAllLabel: 'Allow All' }

test('showDialog: no backend → unavailable', () => {
  const r = showDialog(opts, { platform: HEADLESS, run: () => { throw new Error('should not run') } })
  assert.equal(r.result, 'unavailable')
})

test('showDialog: spawn failure → unavailable', () => {
  const r = showDialog(opts, { platform: ZENITY, run: () => ({ error: new Error('ENOENT'), status: null, stdout: '' }) })
  assert.equal(r.result, 'unavailable')
})

test('showDialog osascript: default button → allow', () => {
  // buttons render [No, Allow All, Yes]; default (rightmost) = "Yes"
  const r = showDialog(opts, { platform: MAC, run: () => ok({ stdout: 'Yes' }) })
  assert.equal(r.result, 'allow')
})

test('showDialog osascript: allow-all button', () => {
  const r = showDialog(opts, { platform: MAC, run: () => ok({ stdout: 'Allow All' }) })
  assert.equal(r.result, 'allow-all')
})

test('showDialog osascript: cancel (non-zero, ran) → deny', () => {
  const r = showDialog(opts, { platform: MAC, run: () => ({ status: 1, signal: null, stdout: '', stderr: 'err' }) })
  assert.equal(r.result, 'deny')
})

test('showDialog osascript: escapes quotes and backslashes in title/labels', () => {
  let script
  const nasty = { title: 'proj "x"\\', body: 'B', allowLabel: 'Yes', denyLabel: 'No' }
  showDialog(nasty, { platform: MAC, run: (_b, args) => { script = args[1]; return ok({ stdout: 'Yes' }) } })
  // The trailing backslash and embedded quotes must be escaped so they can't
  // terminate the AppleScript string literal early.
  assert.match(script, /with title "proj \\"x\\"\\\\"/)
})

test('showDialog osascript: a quote in a button label still matches the raw click', () => {
  // osascript returns the displayed (unescaped) label; comparison uses raw text.
  const quoted = { title: 'T', body: 'B', allowLabel: 'Say "hi"', denyLabel: 'No' }
  const r = showDialog(quoted, { platform: MAC, run: () => ok({ stdout: 'Say "hi"' }) })
  assert.equal(r.result, 'allow')
})

test('showChoiceDialog osascript: escapes options in the list literal', () => {
  let script
  showChoiceDialog({ title: 'T', body: 'Pick', options: ['a"b', 'c\\d'] },
    { platform: MAC, run: (_b, args) => { script = args[1]; return ok({ stdout: 'a"b\n' }) } })
  assert.match(script, /"a\\"b"/)
  assert.match(script, /"c\\\\d"/)
})

test('showNotification osascript: escapes quotes in title/message', () => {
  let seenArgs
  showNotification({ title: 'done "x"', message: 'proj\\' },
    { platform: MAC, run: (_b, args) => { seenArgs = args; return ok() } })
  const joined = seenArgs.join(' ')
  assert.match(joined, /with title "done \\"x\\""/)
  assert.match(joined, /display notification "proj\\\\"/)
})

test('showDialog zenity: ok → allow', () => {
  const r = showDialog(opts, { platform: ZENITY, run: () => ok() })
  assert.equal(r.result, 'allow')
})

test('showDialog zenity: extra button → allow-all', () => {
  const r = showDialog(opts, { platform: ZENITY, run: () => ({ status: 1, stdout: 'Allow All\n', stderr: '' }) })
  assert.equal(r.result, 'allow-all')
})

test('showDialog zenity: cancel → deny', () => {
  const r = showDialog(opts, { platform: ZENITY, run: () => ({ status: 1, stdout: '', stderr: '' }) })
  assert.equal(r.result, 'deny')
})

test('showDialog kdialog: yes=0 → allow, no=1 → allow-all', () => {
  assert.equal(showDialog(opts, { platform: KDIALOG, run: () => ok() }).result, 'allow')
  assert.equal(showDialog(opts, { platform: KDIALOG, run: () => ({ status: 1, stdout: '' }) }).result, 'allow-all')
  assert.equal(showDialog(opts, { platform: KDIALOG, run: () => ({ status: 2, stdout: '' }) }).result, 'deny')
})

test('showDialog passes the resolved binary path to run', () => {
  let seen
  showDialog(opts, { platform: ZENITY, run: (bin) => { seen = bin; return ok() } })
  assert.equal(seen, '/usr/bin/zenity')
})

// ── input dispatch ──
const inOpts = { title: 'T', body: 'B' }

test('showInputDialog: no backend → null', () => {
  assert.equal(showInputDialog(inOpts, { platform: HEADLESS, run: () => { throw new Error('nope') } }), null)
})

test('showInputDialog zenity: text → {text}', () => {
  const r = showInputDialog(inOpts, { platform: ZENITY, run: () => ok({ stdout: 'use redis\n' }) })
  assert.deepEqual(r.text, 'use redis')
})

test('showInputDialog osascript: multi-line text area, preserves newlines', () => {
  let script
  const r = showInputDialog(inOpts, { platform: MAC, run: (_b, args) => { script = args[1]; return ok({ stdout: 'line one\nline two\n' }) } })
  assert.match(script, /NSTextView/)
  assert.equal(r.text, 'line one\nline two')
})
test('showInputDialog osascript: cancel sentinel → null', () => {
  const r = showInputDialog(inOpts, { platform: MAC, run: () => ok({ stdout: '@@KNOWTIFY_CANCEL@@\n' }) })
  assert.equal(r, null)
})

test('showInputDialog zenity: cancel → null', () => {
  assert.equal(showInputDialog(inOpts, { platform: ZENITY, run: () => ({ status: 1, stdout: '' }) }), null)
})

test('showInputDialog: empty text → null', () => {
  assert.equal(showInputDialog(inOpts, { platform: ZENITY, run: () => ok({ stdout: '   \n' }) }), null)
})

// ── choice dispatch ──
const choiceOpts = { title: 'T', body: 'Pick', options: ['A', 'B', 'C'] }

test('showChoiceDialog: no options → cancel', () => {
  const r = showChoiceDialog({ title: 'T', body: 'B', options: [] }, { platform: ZENITY, run: () => { throw new Error('nope') } })
  assert.equal(r.result, 'cancel')
})

test('showChoiceDialog: no backend → unavailable', () => {
  const r = showChoiceDialog(choiceOpts, { platform: HEADLESS, run: () => { throw new Error('nope') } })
  assert.equal(r.result, 'unavailable')
})

test('showChoiceDialog zenity: single selection parsed', () => {
  const r = showChoiceDialog(choiceOpts, { platform: ZENITY, run: () => ok({ stdout: 'B\n' }) })
  assert.equal(r.result, 'ok')
  assert.deepEqual(r.selected, ['B'])
})

test('showChoiceDialog zenity: prints the label column, not the toggle', () => {
  let seenArgs
  showChoiceDialog(choiceOpts, { platform: ZENITY, run: (_b, args) => { seenArgs = args; return ok({ stdout: 'B\n' }) } })
  assert.ok(seenArgs.includes('--print-column=2'))
})

test('showChoiceDialog zenity: multi-select newline-separated', () => {
  const r = showChoiceDialog({ ...choiceOpts, multiSelect: true }, { platform: ZENITY, run: () => ok({ stdout: 'A\nC\n' }) })
  assert.deepEqual(r.selected, ['A', 'C'])
})

test('showChoiceDialog zenity: cancel → cancel', () => {
  const r = showChoiceDialog(choiceOpts, { platform: ZENITY, run: () => ({ status: 1, stdout: '' }) })
  assert.equal(r.result, 'cancel')
})

test('showChoiceDialog: spawn failure → unavailable', () => {
  const r = showChoiceDialog(choiceOpts, { platform: ZENITY, run: () => ({ error: new Error('ENOENT'), status: null, stdout: '' }) })
  assert.equal(r.result, 'unavailable')
})

test('showChoiceDialog osascript: cancel sentinel → cancel', () => {
  const r = showChoiceDialog(choiceOpts, { platform: MAC, run: () => ok({ stdout: '@@KNOWTIFY_CANCEL@@\n' }) })
  assert.equal(r.result, 'cancel')
})

// ── notification dispatch ──
test('showNotification: no backend → false', () => {
  assert.equal(showNotification({ title: 'T', message: 'M' }, { platform: HEADLESS, run: () => { throw new Error('nope') } }), false)
})
test('showNotification osascript: dispatched with default sound → true', () => {
  let seenArgs
  const r = showNotification({ title: 'T', message: 'M' }, { platform: MAC, run: (_b, args) => { seenArgs = args; return ok() } })
  assert.equal(r, true)
  assert.match(seenArgs.join(' '), /display notification "M" with title "T".*sound name "Glass"/)
})
test('showNotification osascript: sound null → silent (no sound name)', () => {
  let seenArgs
  showNotification({ title: 'T', message: 'M', sound: null }, { platform: MAC, run: (_b, args) => { seenArgs = args; return ok() } })
  assert.doesNotMatch(seenArgs.join(' '), /sound name/)
})
test('showNotification notify-send: passes title + message (+ sound hint)', () => {
  let seen
  const r = showNotification({ title: 'T', message: 'M' }, { platform: ZENITY, run: (bin, args) => { seen = { bin, args }; return ok() } })
  assert.equal(r, true)
  assert.equal(seen.bin, '/usr/bin/notify-send')
  assert.deepEqual(seen.args, ['T', 'M', '-h', 'string:sound-name:complete'])
})
test('showNotification notify-send: sound null → no hint', () => {
  let seen
  showNotification({ title: 'T', message: 'M', sound: null }, { platform: ZENITY, run: (_b, args) => { seen = args; return ok() } })
  assert.deepEqual(seen, ['T', 'M'])
})
test('showNotification: spawn failure → false', () => {
  assert.equal(showNotification({ title: 'T', message: 'M' }, { platform: MAC, run: () => ({ error: new Error('x'), status: null }) }), false)
})

// ── focus dispatch ──
test('isHostAppFrontmost: no focus backend → false (fail open)', () => {
  assert.equal(isHostAppFrontmost({ platform: HEADLESS, run: () => { throw new Error('nope') } }), false)
})

test('isHostAppFrontmost xdotool: active window not an ancestor → false', () => {
  // xdotool reports pid 999999 which won't be in our ancestry; ps breaks the walk.
  const run = (bin) => bin.endsWith('xdotool')
    ? { status: 0, stdout: '999999\n' }
    : { status: 1, stdout: '' }
  assert.equal(isHostAppFrontmost({ platform: ZENITY, run }), false)
})

test('isHostAppFrontmost xdotool: failure → false', () => {
  const run = () => ({ status: 1, stdout: '' })
  assert.equal(isHostAppFrontmost({ platform: ZENITY, run }), false)
})

// ── focusHostApp ──
test('focusHostApp: no focus backend → false', () => {
  assert.equal(focusHostApp({ platform: HEADLESS, run: () => { throw new Error('nope') } }), false)
})

test('focusHostApp osascript: GUI ancestor found → activates (ok)', () => {
  const calls = []
  const run = (bin, args) => {
    calls.push(bin)
    if (bin === 'ps') return { status: 0, stdout: '1\n' }        // ppid walk → stop at init
    if (bin.endsWith('osascript')) return { status: 0, stdout: 'ok\n' }
    return { status: 1, stdout: '' }
  }
  assert.equal(focusHostApp({ platform: MAC, run }), true)
  assert.ok(calls.some(b => b.endsWith('osascript')))
})

test('focusHostApp osascript: no GUI ancestor → false', () => {
  const run = (bin) => {
    if (bin === 'ps') return { status: 0, stdout: '1\n' }
    if (bin.endsWith('osascript')) return { status: 0, stdout: 'none\n' }
    return { status: 1, stdout: '' }
  }
  assert.equal(focusHostApp({ platform: MAC, run }), false)
})

test('focusHostApp xdotool: raises first window owned by an ancestor', () => {
  const seen = []
  const run = (bin, args) => {
    if (bin === 'ps') return { status: 0, stdout: '1\n' }
    if (bin.endsWith('xdotool') && args[0] === 'search') return { status: 0, stdout: '42\n' }
    if (bin.endsWith('xdotool') && args[0] === 'windowactivate') { seen.push(args[1]); return { status: 0, stdout: '' } }
    return { status: 1, stdout: '' }
  }
  assert.equal(focusHostApp({ platform: ZENITY, run }), true)
  assert.deepEqual(seen, ['42'])
})
