#!/usr/bin/env node
/**
 * Claude Code PermissionRequest hook entry point.
 * Thin: read stdin → orchestrator → write JSON to stdout.
 */
import { readStdin, parseJsonSafe } from '../../core/io.mjs'
import { handlePermissionRequest } from '../lib/permission-request.mjs'

async function main() {
  const raw = await readStdin()
  if (!raw.trim()) process.exit(0)

  const parsed = parseJsonSafe(raw)
  if (!parsed.ok) {
    process.stderr.write('knowtify: invalid PermissionRequest JSON\n')
    process.exit(1)
  }

  if (parsed.value.hook_event_name !== 'PermissionRequest') process.exit(0)

  const output = await handlePermissionRequest(parsed.value)
  if (output) process.stdout.write(JSON.stringify(output))
  process.exit(0)
}

main().catch((err) => {
  process.stderr.write(`knowtify hook error: ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
