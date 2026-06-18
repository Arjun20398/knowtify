#!/usr/bin/env bash
# Knowtify uninstaller

set -uo pipefail

INSTALL_DIR="$HOME/.knowtify"
SETTINGS="$HOME/.claude/settings.json"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
step() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }

bold "Knowtify — uninstaller"
echo "──────────────────────"

# ── 1. Claude settings.json ──────────────────────────────
step "Removing Claude hooks from $SETTINGS"
if [[ -f "$SETTINGS" ]]; then
  node - "$SETTINGS" <<'EOF'
import fs from 'fs'
const [,,p] = process.argv
let s; try { s = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { process.exit(0) }
let changed = false
for (const event of ['PermissionRequest', 'Stop']) {
  if (!Array.isArray(s.hooks?.[event])) continue
  const before = s.hooks[event].length
  s.hooks[event] = s.hooks[event].filter(e =>
    !Array.isArray(e.hooks) || !e.hooks.some(h => h.command?.includes('knowtify')))
  if (s.hooks[event].length !== before) changed = true
  if (!s.hooks[event].length) delete s.hooks[event]
}
if (changed) { fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n'); console.log('  Removed ✓') }
else console.log('  None found, skipping')
EOF
else
  echo "  settings.json not found, skipping"
fi

# ── 2. Remove install directory ──────────────────────────
step "Removing $INSTALL_DIR"
if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "  Removed ✓"
else
  echo "  Not found, skipping"
fi

echo ""
echo "Knowtify uninstalled. Agents use their built-in prompts again."
