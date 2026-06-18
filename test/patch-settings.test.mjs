import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PATCH = path.join(REPO, 'claude/scripts/patch-settings.mjs')

function tmpFile(name) {
  return path.join(os.tmpdir(), `kn-settings-${name}-${process.pid}-${Date.now()}.json`)
}
function runPatch(file, cmd, event) {
  const args = [PATCH, file, cmd]
  if (event) args.push(event)
  return spawnSync('node', args, { encoding: 'utf8' })
}

test('fresh file → PermissionRequest with matcher "*"', () => {
  const f = tmpFile('fresh')
  runPatch(f, 'node /x/knowtify/claude/hooks/permission-request.mjs')
  const s = JSON.parse(fs.readFileSync(f, 'utf8'))
  fs.unlinkSync(f)
  assert.equal(s.hooks.PermissionRequest.length, 1)
  assert.equal(s.hooks.PermissionRequest[0].matcher, '*')
})

test('Stop event → no matcher', () => {
  const f = tmpFile('stop')
  runPatch(f, 'node /x/knowtify/claude/hooks/stop.mjs', 'Stop')
  const s = JSON.parse(fs.readFileSync(f, 'utf8'))
  fs.unlinkSync(f)
  assert.equal(s.hooks.Stop[0].matcher, undefined)
})

test('idempotent — second run byte-identical', () => {
  const f = tmpFile('idem')
  const cmd = 'node /x/knowtify/claude/hooks/permission-request.mjs'
  runPatch(f, cmd)
  const first = fs.readFileSync(f, 'utf8')
  const r2 = runPatch(f, cmd)
  const second = fs.readFileSync(f, 'utf8')
  fs.unlinkSync(f)
  assert.equal(first, second)
  assert.match(r2.stdout, /already registered/)
})

test('converges — stale knowtify path collapses to one current entry', () => {
  const f = tmpFile('conv')
  fs.writeFileSync(f, JSON.stringify({
    hooks: { PermissionRequest: [
      { matcher: '*', hooks: [{ type: 'command', command: 'node /OLD/.knowtify/integrations/claude-plugin/hooks/permission-request.mjs' }] },
    ] },
  }, null, 2))
  runPatch(f, 'node /Users/me/.knowtify/claude/hooks/permission-request.mjs')
  const s = JSON.parse(fs.readFileSync(f, 'utf8'))
  fs.unlinkSync(f)
  assert.equal(s.hooks.PermissionRequest.length, 1)
  assert.match(s.hooks.PermissionRequest[0].hooks[0].command, /\/claude\/hooks\/permission-request\.mjs$/)
})

test('preserves unrelated hooks in other events', () => {
  const f = tmpFile('preserve')
  fs.writeFileSync(f, JSON.stringify({
    hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: '/other/tool checkpoint' }] }] },
  }, null, 2))
  runPatch(f, 'node /x/knowtify/claude/hooks/permission-request.mjs')
  const s = JSON.parse(fs.readFileSync(f, 'utf8'))
  fs.unlinkSync(f)
  assert.equal(s.hooks.PostToolUse[0].hooks[0].command, '/other/tool checkpoint')
  assert.ok(s.hooks.PermissionRequest)
})
