#!/usr/bin/env node
/**
 * Install-time platform setup.
 *
 * Detects which GUI backends are available on this machine and writes the
 * snapshot to ~/.knowtify/platform.json so the hooks know — at runtime —
 * exactly which tool to use. Prints a human summary + actionable warnings for
 * the installer to surface. Always exits 0: a missing tool is a degraded
 * experience (defer to the host app's own prompts), not a fatal install error.
 */
import { detectPlatformConfig, savePlatformConfig } from '../core/platform.mjs'

const cfg = detectPlatformConfig()
savePlatformConfig(cfg)

const dialog = cfg.dialog ? cfg.dialog.tool : 'none'
const notify = cfg.notify ? cfg.notify.tool : 'none'
const focus  = cfg.focus  ? cfg.focus.tool  : 'none'
console.log(`  Platform: ${cfg.os}  ·  dialog: ${dialog}  ·  notify: ${notify}  ·  focus: ${focus}`)

if (cfg.os === 'unknown') {
  console.log('  ⚠ Unsupported OS — dialogs are skipped; Claude falls back to its own prompts.')
} else if (cfg.os === 'linux') {
  if (!cfg.dialog) {
    console.log('  ⚠ No dialog tool found. Install one to get popups:')
    console.log('      sudo apt install zenity     # GNOME')
    console.log('      sudo apt install kdialog    # KDE')
    console.log("    Until then, Knowtify defers to Claude's in-terminal prompts.")
  }
  if (!cfg.notify) {
    console.log('  ⚠ No notifier found — "done" banners disabled. Install:  sudo apt install libnotify-bin')
  }
  if (!cfg.focus) {
    console.log('  ⚠ xdotool not found — focus detection disabled, so dialogs may pop even when')
    console.log('    Claude is already in front. Install (X11 only):  sudo apt install xdotool')
  }
}
