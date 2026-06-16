#!/usr/bin/env bash
# Knowtify uninstaller

set -euo pipefail

INSTALL_DIR="$HOME/.knowtify"
SETTINGS="$HOME/.claude/settings.json"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
step() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }

bold "Knowtify — uninstaller"
echo "──────────────────────"

# ── 1. Remove hook from settings.json ───────────────────
step "Removing PermissionRequest hook from $SETTINGS"

if [[ -f "$SETTINGS" ]]; then
  node - "$SETTINGS" <<'EOF'
import fs from 'fs'
const [,,settingsPath] = process.argv
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
if (settings.hooks?.PermissionRequest) {
  const MARKER = 'knowtify'
  settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter(entry =>
    !Array.isArray(entry.hooks) ||
    !entry.hooks.some(h => h.command?.includes(MARKER))
  )
  if (settings.hooks.PermissionRequest.length === 0) {
    delete settings.hooks.PermissionRequest
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  console.log('  Hook removed ✓')
} else {
  console.log('  No hook found, skipping')
}
EOF
else
  echo "  settings.json not found, skipping"
fi

# ── 2. Remove KnowtifyNotify.app from macOS Notifications ─
step "Cleaning up macOS notification registry"

# Remove any leftover TCC entry for the old Swift notifier
tccutil reset Notifications com.knowtify.notify 2>/dev/null \
  && echo "  Notification entry cleared ✓" \
  || echo "  No notification entry found (already clean)"

# ── 3. Remove install directory ──────────────────────────
step "Removing $INSTALL_DIR"

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "  Removed ✓"
else
  echo "  Not found, skipping"
fi

echo ""
echo "Knowtify uninstalled. Claude will use its built-in permission prompts again."
