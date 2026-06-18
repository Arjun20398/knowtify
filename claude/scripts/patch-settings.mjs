#!/usr/bin/env node
/**
 * Safely adds a Knowtify hook to ~/.claude/settings.json.
 * Idempotent — running multiple times won't duplicate the entry.
 *
 * Usage: patch-settings.mjs <settings.json path> <hook command> [event]
 *   event defaults to "PermissionRequest".
 */
import fs from 'fs'
import path from 'path'

const [, , settingsPath, hookCmd, eventArg] = process.argv
const event = eventArg || 'PermissionRequest'

if (!settingsPath || !hookCmd) {
  console.error('Usage: patch-settings.mjs <settings.json path> <hook command> [event]')
  process.exit(1)
}

// Load or create settings
let settings = {}
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch {
    console.error(`Failed to parse ${settingsPath}`)
    process.exit(1)
  }
}

// Ensure hooks.<event> array exists
settings.hooks ??= {}
settings.hooks[event] ??= []

// Drop any stale Knowtify entries for this event (e.g. old install paths),
// then add the current one. The file always converges on a single entry.
settings.hooks[event] = settings.hooks[event].filter(entry =>
  !Array.isArray(entry.hooks) ||
  !entry.hooks.some(h => typeof h.command === 'string' && h.command.includes('knowtify'))
)

// PermissionRequest/PreToolUse use a tool matcher; lifecycle events (Stop) do
// not. `.*` (match-all regex) mirrors the plugin's hooks.json.
const entry = (event === 'PermissionRequest' || event === 'PreToolUse')
  ? { matcher: '.*', hooks: [{ type: 'command', command: hookCmd }] }
  : { hooks: [{ type: 'command', command: hookCmd }] }

settings.hooks[event].push(entry)

const before = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : ''
const after = JSON.stringify(settings, null, 2) + '\n'

if (before === after) {
  console.log(`  ${event} hook already registered, nothing to do.`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
fs.writeFileSync(settingsPath, after)
