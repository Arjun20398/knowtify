import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonSafe } from '../core/io.mjs'
import { formatLine } from '../core/logger.mjs'

test('parseJsonSafe: valid', () => {
  const r = parseJsonSafe('{"a":1}')
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { a: 1 })
})
test('parseJsonSafe: invalid → ok:false, no throw', () => {
  const r = parseJsonSafe('{bad')
  assert.equal(r.ok, false)
  assert.ok(r.error instanceof Error)
})

test('formatLine: includes level + msg + extra JSON', () => {
  const line = formatLine('info', 'hello', { a: 1 })
  assert.match(line, /INFO hello \{"a":1\}$/)
})
test('formatLine: omits extra when absent', () => {
  const line = formatLine('warn', 'bye')
  assert.match(line, /WARN bye$/)
})
