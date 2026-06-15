# Knowtify

When Claude Code asks for permission, instead of switching to the terminal to type `1 / 2 / 3`, a native macOS dialog pops up wherever you are.

![dialog showing Yes / Allow All / No buttons]

---

## Requirements

| | |
|---|---|
| macOS | 12 Monterey or later |
| Node.js | 18 or later |
| Claude Code | any recent version |

---

## Install

**Option A — from a local clone (current)**

```bash
git clone https://github.com/Arjun20398/knowtify ~/.knowtify
bash ~/.knowtify/install.sh
```

**Option B — one-liner (once published)**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Arjun20398/knowtify/main/install.sh)
```

The installer:
1. Copies files to `~/.knowtify`
2. Adds a `PermissionRequest` hook to `~/.claude/settings.json`
3. Done — no background daemon, no notification permissions needed

---

## How it works

```
Claude Code triggers a permission check
          │
          ▼
  hooks/permission-request.mjs   (our Node.js hook)
          │
          ▼
  osascript display dialog       (built-in macOS)
          │
    ┌─────┴──────────┬──────┐
   Yes           Allow All   No
    │                │        │
    └────────────────┴────────┘
          │
          ▼
  Decision sent back to Claude — no typing required
```

---

## Uninstall

```bash
bash ~/.knowtify/uninstall.sh
```

Removes the hook from `~/.claude/settings.json` and deletes `~/.knowtify`.

---

## Roadmap

- [ ] Cursor / Windsurf / Copilot support
- [ ] Linux (libnotify) and Windows (PowerShell toast) notification backends
- [ ] Daemon for polling-based alerts when sessions are waiting
