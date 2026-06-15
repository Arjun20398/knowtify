import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { NOTIFIER_BIN, PENDING_DIR } from '../paths.mjs'
import { warn, error, info } from '../logger.mjs'

/**
 * @param {import('../types.mjs').PendingPrompt} prompt
 * @param {string} knowtifyBin
 */
export function notifyPrompt(prompt, knowtifyBin) {
  if (!fs.existsSync(NOTIFIER_BIN)) {
    warn('macOS notifier missing — run: npm run build:notifier')
    return fallbackNotify(prompt)
  }

  const choices = prompt.choices || [
    { id: 'yes', label: 'Yes', action: 'yes' },
    { id: 'yes-all', label: 'Allow All', action: 'yes-all' },
    { id: 'no', label: 'No', action: 'no' },
  ]

  const args = [
    '--id', prompt.id,
    '--title', `Knowtify · ${capitalize(prompt.tool)}`,
    '--subtitle', prompt.project,
    '--body', prompt.summary,
    '--respond-cmd', knowtifyBin,
    '--action-yes', choices[0]?.label || 'Yes',
    '--action-yes-all', choices[1]?.label || 'Allow All',
    '--action-no', choices[2]?.label || 'No',
  ]

  const child = spawn(NOTIFIER_BIN, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderrText = ''
  child.stderr?.on('data', (chunk) => { stderrText += chunk.toString() })

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      error('notifier exited — permission likely denied', {
        code,
        stderr: stderrText.trim(),
        id: prompt.id,
        fix: 'System Settings → Notifications → Knowtify Notify → Allow Notifications (set style to Alerts)',
      })
      // Play a sound so the user knows something needs attention,
      // but do NOT use osascript display notification — clicking that
      // opens Script Editor, which is confusing and useless.
      playSound()
    }
  })

  child.unref()
  info('notification dispatched', { id: prompt.id })
}

function playSound() {
  spawn('afplay', ['/System/Library/Sounds/Ping.aiff'], {
    detached: true, stdio: 'ignore',
  }).unref()
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * @param {string} platform
 */
export function isSupportedPlatform(platform) {
  return platform === 'darwin'
}
