# Knowtify — Universal AI Input Notifier

**Date:** 2026-06-15  
**Status:** Draft — awaiting review  
**Vision:** One notification, any AI tool, respond without switching windows

---

## Problem

You run multiple AI coding assistants in parallel — Claude Code in terminals, Cursor agents, Windsurf, Copilot CLI, etc. Each blocks on permission prompts:

> `Yes` · `Yes, allow all for this session` · `No`

Today you must alt-tab through every window to find which one is waiting. With 4+ sessions this is constant context-switching.

---

## Goal

**Knowtify** is a lightweight background service that:

1. **Watches** all installed AI tools for "needs your input" state
2. **Sends one OS notification** when any tool is blocked (deduped, not spammy)
3. **Lets you respond directly from the notification** — tap Yes / Allow All / No without switching to that window

Works on any machine. No hardcoded paths. Auto-detects which tools are installed.

---

## What changed from v1 spec

| v1 (session-radar) | v2 (knowtify) |
|--------------------|---------------|
| Claude Code plugin only | Cross-tool daemon + optional per-tool hooks |
| `/sessions` slash command | Background poller + OS notifications |
| Read-only status | **Respond from notification** |
| 1-hour scope | Phased — full vision is multi-day |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     knowtify daemon (always on)                   │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Providers  │  │  Aggregator │  │  Notifier   │              │
│  │  (adapters) │─►│  + dedupe   │─►│  (OS native)│              │
│  └─────────────┘  └─────────────┘  └──────┬──────┘              │
│         ▲                                  │ action clicked      │
│         │ poll / push                      ▼                     │
│  ┌──────┴──────────────────────────────────────────┐            │
│  │              Responders (per tool type)          │            │
│  └─────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲              ▲
         │              │              │              │
   Claude Code      Cursor         Windsurf       Copilot CLI
   (agents --json)  (hook/ext)     (hook/ext)     (process/heuristic)
```

### Core principle: provider adapter pattern

Each AI tool gets a **provider** that implements:

```typescript
interface Provider {
  id: string                    // "claude" | "cursor" | "windsurf" | "copilot"
  detect(): boolean             // is this tool installed?
  scan(): PendingPrompt[]       // what's waiting right now?
  respond(promptId: string, action: "yes" | "yes-all" | "no"): void
}

interface PendingPrompt {
  id: string                   // stable key for dedupe
  tool: string
  project: string              // short name from cwd
  summary: string              // "Bash: npm install" or "Edit: src/foo.ts"
  pid?: number
  tty?: string                 // for terminal injection
  appBundle?: string           // for IDE focus (com.todesktop.*)
  waitingSince: number
}
```

Providers are independent. Missing tools are silently skipped — nothing breaks if you only have Claude.

---

## Per-tool detection & response strategy

| Tool | Detection (priority order) | Respond from notification |
|------|---------------------------|---------------------------|
| **Claude Code** | `claude agents --json` → `status: "waiting"`, `waitingFor` | **PTY keystroke** to session TTY (`1`/`2`/`3` or `y`/`a`/`n`) |
| **Copilot CLI** | Process scan + transcript tail heuristic | PTY keystroke (same pattern as Claude) |
| **Cursor** | Cursor hook → `~/.knowtify/events/` **or** extension bridge on `localhost:7433` | Extension IPC → approve/deny in IDE **or** focus Cursor + accessibility click |
| **Windsurf** | Same as Cursor (Codeium fork, similar data dirs) | Same as Cursor |
| **VS Code Copilot** | Extension in VS Code marketplace (phase 3) | Extension IPC |

### Honest constraints

- **Claude Code** has the best API today (`claude agents --json` + `waitingFor`). This is our v1 anchor.
- **IDE tools (Cursor, Windsurf)** have no public "list waiting prompts" API. We need a thin hook or extension that reports to Knowtify. Polling alone won't reliably detect IDE permission dialogs.
- **Respond from notification** for terminal tools is feasible via TTY injection. For IDEs it requires an extension bridge — accessibility-only is fragile and needs macOS Accessibility permission.

---

## Notification UX

When any provider reports a pending prompt:

```
┌─────────────────────────────────────────────┐
│ Knowtify                                    │
│ Claude · sei-data-platform                  │
│ Allow Bash: npm install?                    │
│                                             │
│  [Yes]  [Allow All]  [No]  [Open]          │
└─────────────────────────────────────────────┘
```

- **One notification per pending prompt** (not one per tool)
- If multiple tools need input → separate notifications, grouped by thread ID
- **Open** focuses the source window (terminal or IDE) as fallback
- Re-notification only if prompt still pending after 60s (configurable)

### Platform notification backends

| OS | Library | Action buttons |
|----|---------|----------------|
| **macOS** | Swift CLI using `UNUserNotificationCenter` (e.g. Herald pattern) | Yes — first-class `UNNotificationAction` |
| **Linux** | `notify-send` + D-Bus (limited) or Electron tray | Partial — actions vary by DE |
| **Windows** | Toast via PowerShell / WinRT | Yes — `ToastAction` |

**v1 targets macOS only** (your machine). Linux/Windows adapters are stubs that log "not yet supported."

---

## Shared state

```
~/.knowtify/
├── config.json          # poll interval, enabled providers, notification prefs
├── state.json           # last known prompts (dedupe / change detection)
├── events/              # push events from hooks/extensions
│   └── <timestamp>.json
└── logs/
    └── knowtify.log
```

No secrets. Portable across users. Created on first run.

---

## Repo structure

```
knowtify/
├── package.json
├── bin/
│   └── knowtify              # CLI: start | stop | status | scan
├── daemon/
│   ├── index.mjs             # main poll loop
│   ├── aggregator.mjs        # merge providers, dedupe
│   └── config.mjs
├── providers/
│   ├── claude.mjs            # claude agents --json
│   ├── copilot.mjs           # stub + heuristic
│   ├── cursor.mjs            # reads ~/.knowtify/events/ from hook
│   └── windsurf.mjs          # stub
├── responders/
│   ├── terminal.mjs          # TTY keystroke injection
│   └── ide.mjs               # focus app (fallback)
├── notifier/
│   └── macos/                # Swift binary or bundled herald-like CLI
│       └── notify.swift
├── integrations/
│   ├── claude-plugin/        # optional: pushes events + /knowtify command
│   │   ├── .claude-plugin/plugin.json
│   │   ├── hooks/hooks.json  # Notification hook → write event
│   │   └── commands/knowtify.md
│   └── cursor-hook/          # phase 2: Cursor hook template
│       └── hooks.json
├── docs/
└── README.md
```

Knowtify is primarily a **standalone daemon**, not a plugin. Per-tool integrations are thin event reporters.

---

## Phased delivery

### Phase 1 — 1 hour (build now)

**Scope:** Claude Code only, macOS, notify + respond

| Deliverable | Details |
|-------------|---------|
| Daemon skeleton | Poll every 3s, `providers/claude.mjs` |
| Notification | macOS alert with Yes / Allow All / No buttons |
| Terminal responder | Inject keystrokes to Claude session TTY |
| CLI | `knowtify start`, `knowtify status`, `knowtify scan` |
| Install | `npm install -g` or `npx knowtify start` |

**Success test:** Trigger a Bash permission prompt in a background Claude session → get notification → tap Yes → prompt resolves without switching terminal.

### Phase 2 — half day

| Deliverable | Details |
|-------------|---------|
| Cursor hook | Writes permission events to `~/.knowtify/events/` |
| Windsurf hook | Same pattern |
| Copilot CLI provider | Process + heuristic detection |
| `knowtify status` TUI | All tools, all sessions, colored |

### Phase 3 — 1–2 days

| Deliverable | Details |
|-------------|---------|
| Cursor/Windsurf extension | Full respond-from-notification via IPC |
| Linux + Windows notifiers | Platform adapters |
| Menu bar icon | Session count badge |
| LaunchAgent / systemd | Auto-start on login |

---

## 1-hour implementation plan (Phase 1)

| Min | Task |
|-----|------|
| 0–10 | Scaffold repo, `package.json`, daemon poll loop |
| 10–25 | `providers/claude.mjs` — wrap `claude agents --json` |
| 25–40 | `notifier/macos` — Swift script or `alerter` wrapper with 3 actions |
| 40–50 | `responders/terminal.mjs` — find TTY from PID, write keystrokes |
| 50–55 | `bin/knowtify` CLI — start/status/scan |
| 55–60 | Manual test: 2 Claude sessions, trigger permission, respond from notification |

---

## Approaches considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **A. Central daemon + provider adapters** | Universal, extensible, one notification surface | More moving parts than a plugin | **Recommended** |
| B. Per-tool plugins only | Simpler per tool | No unified notification; user installs N plugins | Reject |
| C. Accessibility-only (watch all UIs) | No per-tool integration | Fragile, needs OS permissions, breaks on UI updates | Fallback for IDEs only |

---

## Portability checklist

- [x] `~/.knowtify/` for state — standard homedir, any user
- [x] Providers auto-detect installed tools — no config required
- [x] `claude` resolved from PATH
- [x] Graceful skip when tool not installed
- [x] No npm deps beyond Node built-ins (phase 1)
- [ ] Cross-platform notifications (phase 3)
- [ ] IDE respond-without-focus (phase 3)

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| TTY injection sends keys to wrong session | Bind prompt to `pid` + `sessionId`; verify TTY via `ps` before write |
| IDE tools lack detection API | Ship hooks/extensions in phase 2; don't promise IDE support in phase 1 |
| macOS blocks notification actions | Bundle signed Swift binary; document System Settings → Notifications permission |
| Notification spam | Dedupe by `prompt.id`; only re-notify if still pending after 60s |
| `claude agents --json` unavailable (old CC) | Skip Claude provider with warning in `knowtify status` |

---

## Open questions

1. **Phase 1 only for the hour?** Claude + macOS + respond — confirm this is the right cut.
2. **Auto-start on login?** LaunchAgent adds ~10 min — skip for hour 1?
3. **Copilot priority?** CLI or VS Code extension first in phase 2?

---

## Approval checklist

- [ ] Name: **knowtify**
- [ ] Architecture: daemon + providers (not plugin-only)
- [ ] Phase 1 scope: Claude Code + macOS + respond from notification
- [ ] Phase 2+: Cursor, Windsurf, Copilot via hooks/extensions
- [ ] Ready to build
