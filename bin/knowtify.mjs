#!/usr/bin/env node

import { fileURLToPath } from 'url'
import {
  handleResponse,
  printStatus,
  runScan,
  startDaemon,
  stopDaemon,
} from '../src/daemon/index.mjs'
import { runSetup } from '../src/cli/setup.mjs'

const [,, command, ...args] = process.argv

async function main() {
  switch (command) {
    case 'start':
      await startDaemon()
      break

    case 'stop':
      stopDaemon()
      break

    case 'status':
      await printStatus()
      break

    case 'scan': {
      const { active, notified, results } = await runScan()
      console.log(`Scanned ${results.length} provider(s), ${active.length} active, ${notified} notified`)
      for (const p of active) {
        console.log(`  ● ${p.tool} · ${p.project} — ${p.summary}`)
      }
      break
    }

    case 'respond': {
      const [promptId, action] = args
      if (!promptId || !action) {
        console.error('Usage: knowtify respond <prompt-id> <yes|yes-all|no|open>')
        process.exit(1)
      }
      const ok = await handleResponse(promptId, /** @type {import('../src/types.mjs').ResponseAction} */ (action))
      process.exit(ok ? 0 : 1)
      break
    }

    case 'setup':
      await runSetup()
      break

    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp()
      break

    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

function printHelp() {
  const bin = fileURLToPath(import.meta.url)
  console.log(`Knowtify — universal AI input notifier

Usage:
  node ${bin} start [--foreground]   Start background daemon
  node ${bin} stop                   Stop daemon
  node ${bin} status                 Show providers and waiting prompts
  node ${bin} scan                   One-shot scan + notify
  node ${bin} setup                  Request notification permission (run once)
  node ${bin} respond <id> <action>  Respond to a prompt (yes|yes-all|no|open)

Install:
  npm link                           Makes 'knowtify' available globally
  npm run build:notifier             Build macOS notification helper
`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
