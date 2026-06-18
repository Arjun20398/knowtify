#!/usr/bin/env bash
# Knowtify installer (Claude Code)
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/Arjun20398/knowtify/main/install.sh)
# Or locally: bash install.sh

set -uo pipefail

INSTALL_DIR="$HOME/.knowtify"
SETTINGS="$HOME/.claude/settings.json"
PERM_HOOK_CMD="node $INSTALL_DIR/claude/hooks/permission-request.mjs"
STOP_HOOK_CMD="node $INSTALL_DIR/claude/hooks/stop.mjs"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
bold()  { printf "\033[1m%s\033[0m\n"  "$*"; }
step()  { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }

bold "Knowtify — native Claude Code permission dialogs (macOS & Linux)"
echo "──────────────────────────────────────────────────────────────────"

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

# ── 2. Sync repo to ~/.knowtify ──────────────────────────
step "Installing to $INSTALL_DIR"
REPO_URL="https://github.com/Arjun20398/knowtify.git"
SRC="$(cd "$(dirname "$0")" && pwd)"

if [[ -f "$SRC/install.sh" && "$SRC" != "$INSTALL_DIR" ]]; then
  echo "  Syncing from local clone: $SRC"
  mkdir -p "$INSTALL_DIR"
  rsync -a --delete --exclude .git --exclude test "$SRC/" "$INSTALL_DIR/"
elif [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "  Existing install found — pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only --quiet
elif [[ "$SRC" == "$INSTALL_DIR" ]]; then
  echo "  Already at install path, skipping copy"
else
  echo "  Cloning $REPO_URL"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
echo "  Files ready ✓"

# ── 3. Detect platform + GUI backends ────────────────────
step "Detecting platform"
node "$INSTALL_DIR/scripts/setup-platform.mjs"
echo "  Saved $INSTALL_DIR/platform.json ✓"

# ── 4. Wire Claude Code hooks ────────────────────────────
step "Registering Claude Code hooks"
node "$INSTALL_DIR/claude/scripts/patch-settings.mjs" "$SETTINGS" "$PERM_HOOK_CMD"
node "$INSTALL_DIR/claude/scripts/patch-settings.mjs" "$SETTINGS" "$STOP_HOOK_CMD" "Stop"
echo "  Registered PermissionRequest + Stop in $SETTINGS ✓"

# ── Done ─────────────────────────────────────────────────
echo ""
green "✓ Knowtify installed!"
echo ""
echo "  When Claude needs you while you're away, a native dialog pops up:"
echo "  pick an option right there, or hit 'Open Claude' to jump back to the"
echo "  window and type your reply. Quiet completions show a small banner."
echo ""
echo "  Uninstall: bash $INSTALL_DIR/uninstall.sh"
echo ""
