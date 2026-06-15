#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/../integrations/claude-plugin" && pwd)"

echo "Installing Knowtify Claude plugin from:"
echo "  $PLUGIN_DIR"
echo ""
echo "Run this inside any Claude Code session:"
echo ""
echo "  /plugin install $PLUGIN_DIR"
echo ""
echo "Or add to ~/.claude/settings.json:"
echo ""
cat <<EOF
{
  "enabledPlugins": {
    "knowtify@local": true
  }
}
EOF
echo ""
echo "Then run once:"
echo "  knowtify setup     # grant macOS notification permission"
echo "  knowtify start     # optional background status daemon"
