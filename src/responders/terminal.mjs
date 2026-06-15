import { execFile } from 'child_process'
import fs from 'fs'
import { promisify } from 'util'
import { loadConfig } from '../config.mjs'
import { debug, warn } from '../logger.mjs'

const execFileAsync = promisify(execFile)

/**
 * @param {number} pid
 * @returns {Promise<string | null>}
 */
async function resolveTty(pid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'tty='])
    const tty = stdout.trim()
    if (!tty || tty === '??' || tty === '-') return null
    return tty.startsWith('/') ? tty : `/dev/${tty}`
  } catch {
    return null
  }
}

/**
 * @param {string} ttyPath
 * @param {string} text
 */
function writeToTty(ttyPath, text) {
  const fd = fs.openSync(ttyPath, 'w')
  try {
    fs.writeSync(fd, text)
  } finally {
    fs.closeSync(fd)
  }
}

/** @type {import('../types.mjs').Responder} */
export const terminalResponder = {
  id: 'terminal',
  type: 'terminal',

  /**
   * @param {import('../types.mjs').PendingPrompt} prompt
   * @param {import('../types.mjs').ResponseAction} action
   */
  async respond(prompt, action) {
    if (action === 'open') {
      return focusTerminal(prompt)
    }

    const config = loadConfig()
    const key = config.terminalKeymap[action]
    if (!key) {
      warn('unknown action for terminal responder', { action })
      return false
    }

    let tty = prompt.tty
    if (!tty && prompt.pid) {
      tty = await resolveTty(prompt.pid)
    }
    if (!tty) {
      warn('no tty for prompt', { id: prompt.id, pid: prompt.pid })
      return false
    }

    try {
      writeToTty(tty, key + '\n')
      debug('sent keystroke to tty', { tty, key, id: prompt.id })
      return true
    } catch (err) {
      warn('tty write failed', {
        tty,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },
}

/**
 * @param {import('../types.mjs').PendingPrompt} prompt
 */
async function focusTerminal(prompt) {
  if (!prompt.pid) return false
  try {
    // Best-effort: bring the terminal window forward via AppleScript
    await execFileAsync('osascript', [
      '-e',
      `tell application "System Events" to set frontmost of first process whose unix id is ${prompt.pid} to true`,
    ])
    return true
  } catch {
    return false
  }
}
