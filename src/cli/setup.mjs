import { spawn } from 'child_process'
import fs from 'fs'
import { NOTIFIER_BIN } from '../paths.mjs'
import { info } from '../logger.mjs'

/**
 * Trigger macOS notification permission prompt for KnowtifyNotify.app
 */
export async function runSetup() {
  if (!fs.existsSync(NOTIFIER_BIN)) {
    console.error('Notifier not built. Run: npm run build:notifier')
    process.exit(1)
  }

  console.log('Requesting notification permission for Knowtify Notify…')
  console.log('If macOS shows a permission dialog, click Allow.')
  console.log()
  console.log('If no dialog appears, open manually:')
  console.log('  System Settings → Notifications → Knowtify Notify → Allow Notifications')
  console.log()

  const child = spawn(
    NOTIFIER_BIN,
    [
      '--id', 'knowtify-setup-test',
      '--title', 'Knowtify Setup',
      '--subtitle', 'Permission test',
      '--body', 'If you see this, notifications are working!',
      '--respond-cmd', process.argv[1] || 'knowtify',
    ],
    { stdio: 'inherit' },
  )

  await new Promise((resolve) => child.on('exit', resolve))
  info('setup test completed')
}
