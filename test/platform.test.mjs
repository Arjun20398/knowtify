import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  OS, resolveBin, detectPlatformConfig, loadPlatformConfig, savePlatformConfig,
} from '../core/platform.mjs'

test('OS: normalized to a known value', () => {
  assert.ok(['macos', 'linux', 'unknown'].includes(OS))
})

test('detectPlatformConfig: macos → osascript for all three', () => {
  const cfg = detectPlatformConfig({ os: 'macos', resolve: () => null })
  assert.equal(cfg.os, 'macos')
  assert.equal(cfg.dialog.tool, 'osascript')
  assert.equal(cfg.notify.tool, 'osascript')
  assert.equal(cfg.focus.tool, 'osascript')
})

test('detectPlatformConfig: linux prefers zenity + notify-send + xdotool', () => {
  const resolve = (n) => ({ zenity: '/usr/bin/zenity', 'notify-send': '/usr/bin/notify-send', xdotool: '/usr/bin/xdotool' }[n] ?? null)
  const cfg = detectPlatformConfig({ os: 'linux', resolve })
  assert.equal(cfg.dialog.tool, 'zenity')
  assert.equal(cfg.notify.tool, 'notify-send')
  assert.equal(cfg.focus.tool, 'xdotool')
})

test('detectPlatformConfig: linux notify falls back to zenity when no notify-send', () => {
  const resolve = (n) => ({ zenity: '/usr/bin/zenity' }[n] ?? null)
  const cfg = detectPlatformConfig({ os: 'linux', resolve })
  assert.equal(cfg.notify.tool, 'zenity')
})

test('detectPlatformConfig: linux falls back to kdialog when no zenity', () => {
  const resolve = (n) => ({ kdialog: '/usr/bin/kdialog' }[n] ?? null)
  const cfg = detectPlatformConfig({ os: 'linux', resolve })
  assert.equal(cfg.dialog.tool, 'kdialog')
  assert.equal(cfg.notify, null)
  assert.equal(cfg.focus, null)
})

test('detectPlatformConfig: linux with no tools → null backends', () => {
  const cfg = detectPlatformConfig({ os: 'linux', resolve: () => null })
  assert.equal(cfg.dialog, null)
  assert.equal(cfg.focus, null)
})

test('detectPlatformConfig: unknown OS → null backends', () => {
  const cfg = detectPlatformConfig({ os: 'plan9', resolve: () => null })
  assert.equal(cfg.os, 'unknown')
  assert.equal(cfg.dialog, null)
})

test('resolveBin: finds an executable on a synthetic PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtify-bin-'))
  const bin = path.join(dir, 'faketool')
  fs.writeFileSync(bin, '#!/bin/sh\n')
  fs.chmodSync(bin, 0o755)
  try {
    assert.equal(resolveBin('faketool', { PATH: dir }), bin)
    assert.equal(resolveBin('missing', { PATH: dir }), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('save/load platform config: round-trips', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'knowtify-cfg-')), 'platform.json')
  const cfg = { os: 'linux', dialog: { tool: 'zenity', path: '/x' }, focus: null }
  savePlatformConfig(cfg, file)
  assert.deepEqual(loadPlatformConfig(file), cfg)
})

test('loadPlatformConfig: missing file → null', () => {
  assert.equal(loadPlatformConfig('/no/such/knowtify-platform.json'), null)
})
