import { spawn } from 'child_process'
import { warn } from '../logger.mjs'

/**
 * Alert the user with a sound that a session needs attention.
 * Used by the daemon polling path when no dialog is appropriate.
 * @param {import('../types.mjs').PendingPrompt} prompt
 */
export function notifyPrompt(prompt) {
  // Play a system sound — no notification permission required
  spawn('afplay', ['/System/Library/Sounds/Ping.aiff'], {
    detached: true, stdio: 'ignore',
  }).unref()
}

/**
 * @param {string} platform
 */
export function isSupportedPlatform(platform) {
  return platform === 'darwin'
}
