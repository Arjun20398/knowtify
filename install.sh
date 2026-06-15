#!/usr/bin/env bash
# Knowtify installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/Arjun20398/knowtify/main/install.sh)
# Or locally: bash install.sh

set -euo pipefail

INSTALL_DIR="$HOME/.knowtify"
HOOK_CMD="node $INSTALL_DIR/integrations/claude-plugin/hooks/permission-request.mjs"
SETTINGS="$HOME/.claude/settings.json"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
bold()  { printf "\033[1m%s\033[0m\n"  "$*"; }
step()  { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }

bold "Knowtify — Claude permission dialog for macOS"
echo "─────────────────────────────────────────────"

# ── 1. Prerequisites ─────────────────────────────────────
step "Checking prerequisites"

if ! command -v node &>/dev/null; then
  red "Node.js not found. Install from https://nodejs.org and re-run."
  exit 1
fi
echo "  node $(node --version) ✓"

if ! command -v claude &>/dev/null; then
  red "Claude Code CLI not found. Install from https://claude.ai/code and re-run."
  exit 1
fi
echo "  claude $(claude --version 2>/dev/null | head -1) ✓"

# ── 2. Clone / update repo ───────────────────────────────
step "Installing to $INSTALL_DIR"

REPO_URL="https://github.com/Arjun20398/knowtify.git"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "  Existing install found — pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only --quiet
elif [[ -f "$(dirname "$0")/package.json" ]]; then
  # Running from a local clone — just symlink / copy in place
  SRC="$(cd "$(dirname "$0")" && pwd)"
  if [[ "$SRC" != "$INSTALL_DIR" ]]; then
    echo "  Copying from $SRC"
    rm -rf "$INSTALL_DIR"
    cp -r "$SRC" "$INSTALL_DIR"
  else
    echo "  Already at install path, skipping copy"
  fi
else
  echo "  Cloning $REPO_URL"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
echo "  Files ready ✓"

# ── 3. Wire hook into ~/.claude/settings.json ────────────
step "Registering PermissionRequest hook"

NODE_PATCHER="$INSTALL_DIR/scripts/patch-settings.mjs"
node "$NODE_PATCHER" "$SETTINGS" "$HOOK_CMD"
echo "  Hook registered in $SETTINGS ✓"

# ── Done ─────────────────────────────────────────────────
echo ""
green "✓ Knowtify installed successfully!"
echo ""
echo "  How it works:"
echo "  When Claude Code asks for permission, a native macOS dialog"
echo "  pops up with Yes / Allow All / No — no terminal switching needed."
echo ""
echo "  To uninstall: bash $INSTALL_DIR/uninstall.sh"
echo ""
