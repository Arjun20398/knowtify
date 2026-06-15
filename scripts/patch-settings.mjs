#!/usr/bin/env node
/**
 * Safely adds the Knowtify PermissionRequest hook to ~/.claude/settings.json.
 * Idempotent — running multiple times won't duplicate the entry.
 */
import fs from 'fs'
import path from 'path'

const [, , settingsPath, hookCmd] = process.argv

if (!settingsPath || !hookCmd) {
  console.error('Usage: patch-settings.mjs <settings.json path> <hook command>')
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

// Ensure hooks.PermissionRequest array exists
settings.hooks ??= {}
settings.hooks.PermissionRequest ??= []

const existing = settings.hooks.PermissionRequest

// Check if our hook is already registered (idempotent)
const alreadyPresent = existing.some(entry =>
  Array.isArray(entry.hooks) &&
  entry.hooks.some(h => h.command === hookCmd)
)

if (alreadyPresent) {
  console.log('  Hook already registered, nothing to do.')
  process.exit(0)
}

// Add our entry
existing.push({
  matcher: '*',
  hooks: [{ type: 'command', command: hookCmd }],
})

// Ensure parent directory exists
fs.mkdirSync(path.dirname(settingsPath), { recursive: true })

// Write back with 2-space indent (preserves readability)
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
