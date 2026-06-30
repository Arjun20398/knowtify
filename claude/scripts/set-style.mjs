#!/usr/bin/env node
/**
 * Set Knowtify's notification style in ~/.knowtify/config.json.
 *
 * Thin CLI wrapper around config.setStyle — the real (testable) logic lives in
 * core/config.mjs. Invoked by the `/knowtify:style` plugin command, but also
 * runnable directly:
 *
 *   node claude/scripts/set-style.mjs notify   # or: dialog
 *   node claude/scripts/set-style.mjs           # → print current style + usage
 *
 * In Claude Code the plugin command is namespaced: `/knowtify:style notify`.
 */
import { setStyle, getConfig, STYLES } from '../../core/config.mjs'

const arg = process.argv[2]

// No argument → report the current setting and how to change it.
if (arg === undefined || arg === '') {
  console.log(`Knowtify style is currently "${getConfig().style}".`)
  console.log(`Change it with: /knowtify:style <${STYLES.join('|')}>`)
  process.exit(0)
}

const result = setStyle(arg)
if (!result.ok) {
  console.error(result.error)
  process.exit(1)
}

console.log(`Knowtify style set to "${result.style}".`)
console.log(result.style === 'notify'
  ? 'Claude will now send a non-blocking banner ("Claude is waiting…") instead of a dialog, and defer to the terminal prompt.'
  : 'Claude will now show a blocking dialog you can act on directly.')
