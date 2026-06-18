import fs from 'fs'
import { logPath, ROLLING_LOG_MAX_LINES, ensureDirs } from './paths.mjs'

function stamp() {
  return new Date().toISOString()
}

/** @returns {string} formatted log line */
export function formatLine(level, msg, extra) {
  return extra
    ? `[${stamp()}] ${level.toUpperCase()} ${msg} ${JSON.stringify(extra)}`
    : `[${stamp()}] ${level.toUpperCase()} ${msg}`
}

/** Keep only the most recent `maxLines` lines in a log file. */
function trimLog(filePath, maxLines) {
  try {
    if (!fs.existsSync(filePath)) return
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
    if (lines.length <= maxLines) return
    fs.writeFileSync(filePath, lines.slice(-maxLines).join('\n') + '\n')
  } catch {
    // ignore trim failures
  }
}

function appendRollingLog(filePath, line, maxLines = ROLLING_LOG_MAX_LINES) {
  try {
    ensureDirs()
    // mode 0600 applies on creation; logs may hold prompt/answer snippets.
    fs.appendFileSync(filePath, line + '\n', { mode: 0o600 })
    trimLog(filePath, maxLines)
  } catch {
    // ignore if log dir missing
  }
}

/**
 * Create a file-only rolling logger for a channel (e.g. 'claude', 'cursor').
 * File-only by design: hook stdout must stay clean JSON for the host app.
 *
 * @param {string} channel
 * @returns {(level: string, msg: string, extra?: unknown) => void}
 */
export function createLogger(channel) {
  const file = logPath(channel)
  return (level, msg, extra) => appendRollingLog(file, formatLine(level, msg, extra))
}
