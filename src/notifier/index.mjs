import { isSupportedPlatform, notifyPrompt } from './macos.mjs'
import { warn } from '../logger.mjs'

/**
 * @param {import('../types.mjs').PendingPrompt} prompt
 * @param {string} knowtifyBin
 */
export function sendNotification(prompt, knowtifyBin) {
  if (process.platform === 'darwin') {
    notifyPrompt(prompt, knowtifyBin)
    return
  }
  warn('notifications not yet supported on this platform', { platform: process.platform })
}

export { isSupportedPlatform }
