#!/usr/bin/env node
/**
 * Claude Code Stop hook entry point.
 *
 * When Claude finishes a turn while you're away from its window and its last
 * message is a question, Knowtify shows a text-input dialog; whatever you type
 * is injected back so Claude continues.
 *
 * stdout must stay clean JSON (Claude parses it), so logging is file-only:
 * ~/.knowtify/logs/claude.log
 */
import { readStdin, parseJsonSafe } from '../../core/io.mjs'
import { createLogger } from '../../core/logger.mjs'
import { handleStop } from '../lib/stop.mjs'

const log = createLogger('claude')

async function main() {
  const raw = await readStdin()
  if (!raw.trim()) process.exit(0)

  const parsed = parseJsonSafe(raw)
  if (!parsed.ok) {
    log('error', 'invalid Stop JSON', { error: String(parsed.error) })
    process.exit(0)
  }

  if (parsed.value.hook_event_name && parsed.value.hook_event_name !== 'Stop') process.exit(0)

  const output = handleStop(parsed.value)
  if (output) process.stdout.write(JSON.stringify(output))
  process.exit(0)
}

main().catch((err) => {
  log('error', 'stop hook exception', { error: String(err), stack: err?.stack })
  process.exit(0)
})
