import { isSupportedPlatform, notifyPrompt } from './macos.mjs'
import { warn } from '../logger.mjs'

/**
 * @param {import('../types.mjs').PendingPrompt} prompt
 */
export function sendNotification(prompt) {
  if (process.platform === 'darwin') {
    notifyPrompt(prompt)
    return
  }
  warn('notifications not yet supported on this platform', { platform: process.platform })
}

export { isSupportedPlatform }
