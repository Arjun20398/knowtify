import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Filesystem layout for Knowtify's runtime state, under ~/.knowtify.
 * Tool-agnostic — every integration shares these.
 */
export const HOME = os.homedir()
export const ROOT = path.join(HOME, '.knowtify')
export const PENDING_DIR = path.join(ROOT, 'pending') // transient lock/result files
export const LOGS_DIR = path.join(ROOT, 'logs')

// Install-time snapshot of the detected platform + GUI backends (see platform.mjs).
export const PLATFORM_CONFIG_PATH = path.join(ROOT, 'platform.json')

export const ROLLING_LOG_MAX_LINES = 1000

/** Path to a per-channel rolling log, e.g. logPath('claude') → …/logs/claude.log */
export function logPath(channel) {
  return path.join(LOGS_DIR, `${channel}.log`)
}

export function ensureDirs() {
  for (const dir of [ROOT, PENDING_DIR, LOGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
