# Knowtify for Claude Code

Native macOS dialogs for Claude Code — so you never have to switch back to the
terminal to answer a prompt.

Two things happen automatically when you're **not** focused on the Claude window:

1. **Permission prompts** → a native Allow / Allow All / Deny dialog pops up
   wherever you are. Your choice is sent straight back to Claude.
2. **"Waiting for your input"** → when Claude ends a turn with a question, a
   text-input dialog appears. Whatever you type is injected back so Claude
   continues — no window switching needed.

If the Claude window is already frontmost, Knowtify stays out of the way and
lets the normal in-terminal flow handle it.

## Layout

```
claude/
├── .claude-plugin/plugin.json   # Claude plugin manifest
├── hooks/
│   ├── hooks.json               # plugin hook registration
│   ├── permission-request.mjs   # PermissionRequest entry point (thin)
│   └── stop.mjs                 # Stop entry point (thin)
├── lib/
│   ├── permission-request.mjs   # pure builders + orchestrator (injected deps)
│   └── stop.mjs                 # question heuristics + orchestrator
└── scripts/
    └── patch-settings.mjs       # registers hooks in ~/.claude/settings.json
```

The macOS dialog, focus detection, logging, and stdin/JSON helpers come from
the shared [`../core`](../core). Each `lib` orchestrator accepts its
side-effecting dependencies as parameters, so the decision logic is unit-tested
(see [`../test`](../test)) without opening a dialog.

## Install

From the repo root:

```bash
bash install.sh
```

That copies the repo to `~/.knowtify` and registers the `PermissionRequest` and
`Stop` hooks in `~/.claude/settings.json`.

## Logs

```
~/.knowtify/logs/claude.log   # rolling, last 1000 lines
```
