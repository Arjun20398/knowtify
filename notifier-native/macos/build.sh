#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/KnowtifyNotify.app"
BIN="$APP/Contents/MacOS/knowtify-notify"

mkdir -p "$APP/Contents/MacOS"

swiftc -O -framework UserNotifications -framework Foundation \
  "$DIR/notify.swift" -o "$BIN"

chmod +x "$BIN"
echo "Built $BIN"
