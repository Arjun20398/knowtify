/**
 * One-line cross-promotion tips that nudge the user toward the *other*
 * notification style. Lives in the Claude adapter (not core/) because the tips
 * reference how to change the style; the setting itself is in core/config.mjs.
 *
 * Install-aware: plugin installs toggle via the `/knowtify:style` command, but
 * a manual (~/.knowtify) install has no slash command, so those users get a
 * config-file hint instead. Plugin hooks run with CLAUDE_PLUGIN_ROOT set; the
 * manual install (plain `node ~/.knowtify/...`) does not — that's the signal.
 *
 * Native dialogs/notifications are plain text (no markdown/monospace), so the
 * command/path is set off with quotes — the closest we get to "code" styling.
 */

const IS_PLUGIN = Boolean(process.env.CLAUDE_PLUGIN_ROOT)

/** Footer on every blocking dialog (style: 'dialog') → how to go quiet. */
export const DIALOG_TIP = IS_PLUGIN
  ? 'Tip: run "/knowtify:style notify" to get a notification instead of this dialog.'
  : 'Tip: set "style": "notify" in ~/.knowtify/config.json to get a notification instead.'

/** Shown in the banner when dialogs are suppressed (style: 'notify') → how to get them back. Kept short so it fits one banner line. */
export const NOTIFY_TIP = IS_PLUGIN
  ? 'Tip: run "/knowtify:style dialog" for clickable choices'
  : 'Tip: set "style": "dialog" in ~/.knowtify/config.json for clickable choices'

/**
 * Append a tip as a footer to a dialog body, separated so it reads as an aside.
 * @param {string} body
 * @param {string} [tip]
 * @returns {string}
 */
export function withTip(body, tip = DIALOG_TIP) {
  return `${body}\n\n———\n${tip}`
}
