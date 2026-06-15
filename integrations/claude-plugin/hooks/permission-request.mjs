#!/usr/bin/env node
/**
 * Claude Code PermissionRequest hook entry point.
 * Reads hook JSON from stdin, shows Knowtify notification, waits for user choice.
 */
import { handlePermissionRequest } from '../../../src/claude/permission-request.mjs'

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => resolve(data))
  })
}

async function main() {
  const raw = await readStdin()
  if (!raw.trim()) process.exit(0)

  let input
  try {
    input = JSON.parse(raw)
  } catch {
    process.stderr.write('knowtify: invalid PermissionRequest JSON\n')
    process.exit(1)
  }

  if (input.hook_event_name !== 'PermissionRequest') {
    process.exit(0)
  }

  const output = await handlePermissionRequest(input)
  if (output) {
    process.stdout.write(JSON.stringify(output))
  }
  process.exit(0)
}

main().catch((err) => {
  process.stderr.write(`knowtify hook error: ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
