import fs from 'fs'
import path from 'path'
import { CONFIG_PATH } from './paths.mjs'

/**
 * User preferences for Knowtify, resolved with a clear precedence:
 *   1. environment variable (KNOWTIFY_STYLE) — per-session/per-project override
 *   2. ~/.knowtify/config.json               — the persisted choice
 *   3. built-in default                      — today's behavior
 *
 * Tool-agnostic, like platform.mjs, and never throws: any missing/garbled
 * input degrades to the default so a bad config can't break a session.
 */

/**
 * How Knowtify asks for attention when the host window isn't frontmost:
 *   'dialog' → a blocking native dialog you act on (default; full Allow/Deny,
 *              reply, and option-button flows)
 *   'notify' → a non-blocking banner ("Claude is waiting…"); Knowtify then
 *              defers to the host app's own in-terminal prompt
 */
export const STYLES = ['dialog', 'notify']
export const DEFAULT_STYLE = 'dialog'

/**
 * When Knowtify should speak up, relative to where your focus is:
 *   'unfocused' → only when the host app/window isn't frontmost (default; if
 *                 you're already watching this Claude, stay quiet)
 *   'always'    → also alert when the app is frontmost. While you're focused on
 *                 the window a blocking modal would interrupt you, so Knowtify
 *                 sends a non-blocking banner instead; your configured `style`
 *                 (dialog/notify) still applies when the window is in the
 *                 background. This is the only way to hear about a Claude
 *                 finishing in a *background terminal tab* of the focused window
 *                 — tabs aren't separate OS windows, so focus detection can't
 *                 tell them apart.
 */
export const NOTIFY_WHEN = ['unfocused', 'always']
export const DEFAULT_NOTIFY_WHEN = 'unfocused'

/** @typedef {{ style: 'dialog' | 'notify', notifyWhen: 'unfocused' | 'always' }} Config */

/** Coerce an untrusted value to a valid style, or null if unrecognized. */
function normalizeStyle(value) {
  const s = String(value ?? '').trim().toLowerCase()
  return STYLES.includes(s) ? s : null
}

/** Coerce an untrusted value to a valid notifyWhen, or null if unrecognized. */
function normalizeNotifyWhen(value) {
  const s = String(value ?? '').trim().toLowerCase()
  return NOTIFY_WHEN.includes(s) ? s : null
}

/**
 * Read ~/.knowtify/config.json. Returns the parsed object, or null if the file
 * is absent, unreadable, or not a JSON object. Arrays are rejected too —
 * otherwise setStyle would set `.style` on an array and serialize it back as
 * `[]`, silently losing the value.
 * @param {string} [file]
 * @returns {Record<string, unknown> | null}
 */
export function loadConfigFile(file = CONFIG_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Resolve the effective config from env → file → default. Never throws.
 * @param {{ env?: NodeJS.ProcessEnv, file?: string, load?: typeof loadConfigFile }} [deps]
 * @returns {Config}
 */
export function getConfig(deps = {}) {
  const env = deps.env ?? process.env
  const load = deps.load ?? loadConfigFile
  const persisted = load(deps.file) ?? {}

  const style =
    normalizeStyle(env.KNOWTIFY_STYLE) ??
    normalizeStyle(persisted.style) ??
    DEFAULT_STYLE

  const notifyWhen =
    normalizeNotifyWhen(env.KNOWTIFY_NOTIFY_WHEN) ??
    normalizeNotifyWhen(persisted.notifyWhen) ??
    DEFAULT_NOTIFY_WHEN

  return { style, notifyWhen }
}

/**
 * Persist a style choice to config.json, preserving any other keys already in
 * the file. Validates the value and never partially writes. Side effects (read,
 * write) are injected so it's testable without touching the real home dir.
 *
 * @param {string} style — desired style; must be one of STYLES
 * @param {{ file?: string, load?: typeof loadConfigFile, writeFile?: (file: string, data: string) => void }} [deps]
 * @returns {{ ok: true, style: string, file: string } | { ok: false, error: string, file: string }}
 */
export function setStyle(style, deps = {}) {
  const s = normalizeStyle(style)
  if (!s) {
    return { ok: false, file: deps.file ?? CONFIG_PATH, error: `Unknown style ${JSON.stringify(String(style ?? ''))}. Use one of: ${STYLES.join(', ')}.` }
  }
  return { ...persistKey('style', s, deps), style: s }
}

/**
 * Persist a notifyWhen choice to config.json (same write semantics as setStyle).
 * @param {string} value — must be one of NOTIFY_WHEN
 * @param {{ file?: string, load?: typeof loadConfigFile, writeFile?: (file: string, data: string) => void }} [deps]
 * @returns {{ ok: true, notifyWhen: string, file: string } | { ok: false, error: string, file: string }}
 */
export function setNotifyWhen(value, deps = {}) {
  const v = normalizeNotifyWhen(value)
  if (!v) {
    return { ok: false, file: deps.file ?? CONFIG_PATH, error: `Unknown value ${JSON.stringify(String(value ?? ''))}. Use one of: ${NOTIFY_WHEN.join(', ')}.` }
  }
  return { ...persistKey('notifyWhen', v, deps), notifyWhen: v }
}

/**
 * Load the config, set one key, and write it back — preserving any other keys
 * already in the file and never partially writing. Shared by the setters.
 * @returns {{ ok: true, file: string }}
 */
function persistKey(key, value, deps = {}) {
  const file = deps.file ?? CONFIG_PATH
  const load = deps.load ?? loadConfigFile
  const writeFile = deps.writeFile ?? defaultWriteFile

  const config = load(file) ?? {}
  config[key] = value
  writeFile(file, JSON.stringify(config, null, 2) + '\n')
  return { ok: true, file }
}

/**
 * Default writer: create the parent dir and write the file using the same
 * private modes as the rest of ~/.knowtify (0700 dir / 0600 file). mkdirSync's
 * `mode` only applies when the dir is first created, so this keeps the tree
 * private even if `/knowtify:style` is the very first thing to touch it (before
 * any hook has run ensureDirs).
 */
function defaultWriteFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, data, { mode: 0o600 })
}
