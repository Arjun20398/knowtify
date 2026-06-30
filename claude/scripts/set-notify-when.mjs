#!/usr/bin/env node
/**
 * Set when Knowtify speaks up (relative to focus) in ~/.knowtify/config.json.
 *
 * Thin CLI wrapper around config.setNotifyWhen — the real (testable) logic lives
 * in core/config.mjs. Invoked by the `/knowtify:notify-when` plugin command, but
 * also runnable directly:
 *
 *   node claude/scripts/set-notify-when.mjs always      # or: unfocused
 *   node claude/scripts/set-notify-when.mjs             # → print current value + usage
 *
 * In Claude Code the plugin command is namespaced: `/knowtify:notify-when always`.
 */
import { setNotifyWhen, getConfig, NOTIFY_WHEN } from '../../core/config.mjs'

const arg = process.argv[2]

// No argument → report the current setting and how to change it.
if (arg === undefined || arg === '') {
  console.log(`Knowtify notify-when is currently "${getConfig().notifyWhen}".`)
  console.log(`Change it with: /knowtify:notify-when <${NOTIFY_WHEN.join('|')}>`)
  process.exit(0)
}

const result = setNotifyWhen(arg)
if (!result.ok) {
  console.error(result.error)
  process.exit(1)
}

console.log(`Knowtify notify-when set to "${result.notifyWhen}".`)
console.log(result.notifyWhen === 'always'
  ? 'Claude will now alert you even when the app is frontmost — a non-blocking banner while you\'re focused here, and your usual style (dialog/notify) when the window is in the background. So a Claude finishing in a background terminal tab still reaches you.'
  : 'Claude will now stay quiet when its window is already frontmost (the default).')
