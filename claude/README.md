# Knowtify for Claude Code

Native macOS dialogs for Claude Code — so you never have to switch back to the
terminal to answer a prompt.

Things happen automatically when you're **not** focused on the Claude window:

1. **Permission prompts** → a native Allow / Allow All / Deny dialog pops up
   wherever you are. Your choice is sent straight back to Claude.
2. **Multiple-choice questions** (`AskUserQuestion`) → rendered as a native list
   dialog; your selection is sent back so Claude continues. Pick *"Other"* to
   answer in your own words back in the Claude window.
3. **Open-ended questions** → when Claude ends a turn waiting on a free-form
   reply, a dialog offers **Open Claude** (jumps you back to the window so you
   type the answer there — no cramped inline box) or **Dismiss**.
4. **Quiet completions** → when Claude finishes without needing input, a small
   banner with a chime appears (e.g. "✻ Clauding for 20s").

If the Claude window is already frontmost, Knowtify stays out of the way and
lets the normal in-terminal flow handle it.

## Layout

```
claude/
├── hooks/
│   ├── permission-request.mjs   # PermissionRequest entry point (thin)
│   └── stop.mjs                 # Stop entry point (thin)
├── lib/
│   ├── permission-request.mjs   # pure builders + orchestrator (injected deps)
│   └── stop.mjs                 # question heuristics + orchestrator
└── scripts/
    └── patch-settings.mjs       # registers hooks in ~/.claude/settings.json (manual install)
```

The plugin manifest (`.claude-plugin/plugin.json`) and hook registration
(`hooks/hooks.json`) live at the **repo root**, not here, so the whole repo
installs as one Claude Code plugin and the hook scripts can still reach the
shared [`../core`](../core). Each `lib` orchestrator accepts its side-effecting
dependencies as parameters, so the decision logic is unit-tested (see
[`../test`](../test)) without opening a dialog.

## Install

Preferred — as a Claude Code plugin (from inside Claude Code):

```
/plugin marketplace add Arjun20398/knowtify
/plugin install knowtify@knowtify
```

Or manually, from the repo root:

```bash
bash install.sh
```

The manual path copies the repo to `~/.knowtify` and registers the
`PermissionRequest` and `Stop` hooks in `~/.claude/settings.json`.

## Logs

```
~/.knowtify/logs/claude.log   # rolling, last 1000 lines
```

Logs are metadata only (project name, session id, timings, message length) —
the assistant's message text is never written to disk. The `~/.knowtify`
directory and its log files are created with owner-only permissions (0700/0600).
