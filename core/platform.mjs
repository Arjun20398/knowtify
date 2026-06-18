import fs from 'fs'
import path from 'path'
import { PLATFORM_CONFIG_PATH, ensureDirs } from './paths.mjs'

/**
 * Platform detection + GUI-backend resolution.
 *
 * Knowtify needs three OS services: show a modal dialog, fire a non-blocking
 * notification, and tell whether the host app is frontmost. Each OS provides
 * these differently:
 *   macOS → osascript (AppleScript) for all three
 *   Linux → zenity/kdialog for dialogs, notify-send (or zenity) for
 *           notifications, xdotool for focus (X11)
 *
 * `install.sh` resolves the available tools once and persists them to
 * ~/.knowtify/platform.json so the hooks know — at runtime — exactly which
 * backend to use without re-probing. If that snapshot is missing (e.g. a plugin
 * user who never ran install.sh), we detect live. Either way this module never
 * throws and degrades to a null backend, so an unsupported OS simply defers to
 * the host app's own prompt instead of breaking the session.
 */

/** Normalized OS id derived from `process.platform`. */
export const OS =
  process.platform === 'darwin' ? 'macos' :
  process.platform === 'linux'  ? 'linux' :
  'unknown'

/**
 * Locate an executable on PATH without spawning a shell.
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null} absolute path or null if not found
 */
export function resolveBin(name, env = process.env) {
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch { /* not here, keep looking */ }
  }
  return null
}

/**
 * @typedef {{ tool: string, path: string }} Backend
 * @typedef {{ os: 'macos' | 'linux' | 'unknown', dialog: Backend | null, notify: Backend | null, focus: Backend | null }} PlatformConfig
 */

/**
 * Detect available GUI backends on this machine right now (PATH lookups only).
 * @param {{ resolve?: typeof resolveBin, os?: typeof OS }} [deps]
 * @returns {PlatformConfig}
 */
export function detectPlatformConfig(deps = {}) {
  const resolve = deps.resolve ?? resolveBin
  const os = deps.os ?? OS

  if (os === 'macos') {
    const osa = '/usr/bin/osascript'
    return {
      os: 'macos',
      dialog: { tool: 'osascript', path: osa },
      notify: { tool: 'osascript', path: osa },
      focus:  { tool: 'osascript', path: osa },
    }
  }

  if (os === 'linux') {
    const zenity     = resolve('zenity')
    const kdialog    = resolve('kdialog')
    const notifySend = resolve('notify-send')
    const xdotool    = resolve('xdotool')
    return {
      os: 'linux',
      dialog:
        zenity  ? { tool: 'zenity',  path: zenity }  :
        kdialog ? { tool: 'kdialog', path: kdialog } :
        null,
      notify:
        notifySend ? { tool: 'notify-send', path: notifySend } :
        zenity     ? { tool: 'zenity',      path: zenity }     :
        null,
      focus: xdotool ? { tool: 'xdotool', path: xdotool } : null,
    }
  }

  return { os: 'unknown', dialog: null, notify: null, focus: null }
}

/**
 * Load the install-time platform snapshot, or null if absent/unreadable.
 * @param {string} [file]
 * @returns {PlatformConfig | null}
 */
export function loadPlatformConfig(file = PLATFORM_CONFIG_PATH) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Persist a platform snapshot (called by the installer).
 * @param {PlatformConfig} config
 * @param {string} [file]
 * @returns {PlatformConfig}
 */
export function savePlatformConfig(config, file = PLATFORM_CONFIG_PATH) {
  ensureDirs()
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
  return config
}

/**
 * The effective config used at runtime. Prefer the install-time snapshot (so
 * behavior matches what install verified) but only when it matches the current
 * OS; otherwise re-detect live. Never throws.
 * @returns {PlatformConfig}
 */
export function getPlatformConfig() {
  const persisted = loadPlatformConfig()
  if (persisted && persisted.os === OS) {
    // Back-fill keys added in newer versions (e.g. `notify`) for snapshots
    // written by an older install, without re-probing the rest.
    if (persisted.notify === undefined) {
      return { ...persisted, notify: detectPlatformConfig().notify }
    }
    return persisted
  }
  return detectPlatformConfig()
}
