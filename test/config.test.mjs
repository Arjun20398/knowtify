import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getConfig, loadConfigFile, setStyle, setNotifyWhen, DEFAULT_STYLE, DEFAULT_NOTIFY_WHEN } from '../core/config.mjs'

test('getConfig: no env, no file → default style', () => {
  const cfg = getConfig({ env: {}, load: () => null })
  assert.equal(cfg.style, DEFAULT_STYLE)
  assert.equal(cfg.style, 'dialog')
})

test('getConfig: file sets notify', () => {
  const cfg = getConfig({ env: {}, load: () => ({ style: 'notify' }) })
  assert.equal(cfg.style, 'notify')
})

test('getConfig: env var sets notify', () => {
  const cfg = getConfig({ env: { KNOWTIFY_STYLE: 'notify' }, load: () => null })
  assert.equal(cfg.style, 'notify')
})

test('getConfig: env wins over file', () => {
  const cfg = getConfig({ env: { KNOWTIFY_STYLE: 'dialog' }, load: () => ({ style: 'notify' }) })
  assert.equal(cfg.style, 'dialog')
})

test('getConfig: env is case-insensitive + trimmed', () => {
  const cfg = getConfig({ env: { KNOWTIFY_STYLE: '  NOTIFY ' }, load: () => null })
  assert.equal(cfg.style, 'notify')
})

test('getConfig: invalid env falls through to file', () => {
  const cfg = getConfig({ env: { KNOWTIFY_STYLE: 'bogus' }, load: () => ({ style: 'notify' }) })
  assert.equal(cfg.style, 'notify')
})

test('getConfig: invalid file value falls through to default', () => {
  const cfg = getConfig({ env: {}, load: () => ({ style: 'whatever' }) })
  assert.equal(cfg.style, 'dialog')
})

test('getConfig: notifyWhen defaults to unfocused', () => {
  const cfg = getConfig({ env: {}, load: () => null })
  assert.equal(cfg.notifyWhen, DEFAULT_NOTIFY_WHEN)
  assert.equal(cfg.notifyWhen, 'unfocused')
})

test('getConfig: notifyWhen from file', () => {
  const cfg = getConfig({ env: {}, load: () => ({ notifyWhen: 'always' }) })
  assert.equal(cfg.notifyWhen, 'always')
})

test('getConfig: KNOWTIFY_NOTIFY_WHEN env wins over file (case-insensitive)', () => {
  const cfg = getConfig({ env: { KNOWTIFY_NOTIFY_WHEN: ' ALWAYS ' }, load: () => ({ notifyWhen: 'unfocused' }) })
  assert.equal(cfg.notifyWhen, 'always')
})

test('getConfig: invalid notifyWhen falls through to default', () => {
  const cfg = getConfig({ env: { KNOWTIFY_NOTIFY_WHEN: 'bogus' }, load: () => ({ notifyWhen: 'nope' }) })
  assert.equal(cfg.notifyWhen, 'unfocused')
})

test('getConfig: style and notifyWhen resolve independently', () => {
  const cfg = getConfig({ env: {}, load: () => ({ style: 'notify', notifyWhen: 'always' }) })
  assert.deepEqual(cfg, { style: 'notify', notifyWhen: 'always' })
})

test('setNotifyWhen: valid value → ok + writes {notifyWhen}', () => {
  let written
  const res = setNotifyWhen('always', { load: () => null, writeFile: (_f, d) => { written = d } })
  assert.equal(res.ok, true)
  assert.equal(res.notifyWhen, 'always')
  assert.deepEqual(JSON.parse(written), { notifyWhen: 'always' })
})

test('setNotifyWhen: normalizes case + trims', () => {
  let written
  const res = setNotifyWhen('  UNFOCUSED ', { load: () => null, writeFile: (_f, d) => { written = d } })
  assert.equal(res.notifyWhen, 'unfocused')
  assert.deepEqual(JSON.parse(written), { notifyWhen: 'unfocused' })
})

test('setNotifyWhen: preserves other keys (e.g. style)', () => {
  let written
  setNotifyWhen('always', { load: () => ({ style: 'notify' }), writeFile: (_f, d) => { written = d } })
  assert.deepEqual(JSON.parse(written), { style: 'notify', notifyWhen: 'always' })
})

test('setNotifyWhen: invalid value → ok:false, never writes', () => {
  let wrote = false
  const res = setNotifyWhen('whenever', { load: () => null, writeFile: () => { wrote = true } })
  assert.equal(res.ok, false)
  assert.match(res.error, /Unknown value/)
  assert.equal(wrote, false)
})

test('loadConfigFile: round-trips a written config', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'knowtify-cfg-')), 'config.json')
  fs.writeFileSync(file, JSON.stringify({ style: 'notify' }))
  assert.deepEqual(loadConfigFile(file), { style: 'notify' })
})

test('loadConfigFile: missing file → null', () => {
  assert.equal(loadConfigFile('/no/such/knowtify-config.json'), null)
})

test('loadConfigFile: non-object JSON → null', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'knowtify-cfg-')), 'config.json')
  fs.writeFileSync(file, '"just a string"')
  assert.equal(loadConfigFile(file), null)
})

test('loadConfigFile: JSON array → null (not a config object)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'knowtify-cfg-')), 'config.json')
  fs.writeFileSync(file, '["notify"]')
  assert.equal(loadConfigFile(file), null)
})

test('setStyle: array file → writes a clean object, not a mutated array', () => {
  let written
  const res = setStyle('notify', { load: () => null, writeFile: (_f, d) => { written = d } })
  // (loadConfigFile already rejects arrays → null; this guards the write shape.)
  assert.equal(res.ok, true)
  assert.deepEqual(JSON.parse(written), { style: 'notify' })
})

test('setStyle: valid value → ok + writes {style}', () => {
  let written
  const res = setStyle('notify', { file: '/x/config.json', load: () => null, writeFile: (f, d) => { written = { f, d } } })
  assert.equal(res.ok, true)
  assert.equal(res.style, 'notify')
  assert.equal(written.f, '/x/config.json')
  assert.deepEqual(JSON.parse(written.d), { style: 'notify' })
})

test('setStyle: normalizes case + trims', () => {
  let written
  const res = setStyle('  DIALOG ', { load: () => null, writeFile: (_f, d) => { written = d } })
  assert.equal(res.style, 'dialog')
  assert.deepEqual(JSON.parse(written), { style: 'dialog' })
})

test('setStyle: preserves other keys in the file', () => {
  let written
  setStyle('notify', { load: () => ({ style: 'dialog', somethingElse: 42 }), writeFile: (_f, d) => { written = d } })
  assert.deepEqual(JSON.parse(written), { style: 'notify', somethingElse: 42 })
})

test('setStyle: invalid value → ok:false, never writes', () => {
  let wrote = false
  const res = setStyle('loud', { load: () => null, writeFile: () => { wrote = true } })
  assert.equal(res.ok, false)
  assert.match(res.error, /Unknown style/)
  assert.equal(wrote, false)
})

test('setStyle: round-trips through a real temp file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'knowtify-cfg-')), 'config.json')
  setStyle('notify', { file })
  assert.equal(getConfig({ env: {}, file }).style, 'notify')
})
