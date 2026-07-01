import { showOptionsDialog } from './core/dialog.mjs'

const bigBody = Array.from({ length: 120 }, (_, i) =>
  `Line ${i + 1}: this is a very long diagnosis body meant to overflow the alert and push buttons off-screen if not scrollable.`
).join('\n')

showOptionsDialog({
  title: 'Claude is waiting for your reply',
  heading: 'Claude is waiting for your reply',
  body: bigBody,
  options: ['A. Terminate the workflow', 'B. Inspect the payload encoding'],
  openLabel: 'Open Claude',
  dismissLabel: 'Dismiss',
})
