# Knowtify

Native desktop dialogs for **Claude Code**. When Claude needs your input — a
permission prompt, or a question while it's waiting — Knowtify pops a dialog
wherever you are, instead of making you switch back to the terminal.

Built and tested primarily on **macOS** (AppleScript). **Linux** is supported
on a best-effort basis via `zenity`/`kdialog` (dialogs), `notify-send`
(banners), and `xdotool` (focus, X11 only); if none are installed, Knowtify
quietly defers to Claude's in-terminal prompts.

> Claude only. Cursor/Windsurf were evaluated and dropped: their hooks can't
> replace the editor's own approval UI, so an external dialog can't be the
> single prompt there. See the note at the bottom.

## Architecture

A small shared core (the "show a dialog over any app + collect the answer"
layer) with a thin Claude adapter on top:

```
knowtify/                       # ← this repo *is* the Claude Code plugin
├── .claude-plugin/
│   ├── plugin.json   # plugin manifest (name, version, hooks)
│   └── marketplace.json # self-marketplace, so `/plugin marketplace add` works
├── hooks/
│   └── hooks.json    # registers PermissionRequest + Stop with Claude Code
│
├── core/        # shared, tool-agnostic primitives
│   ├── dialog.mjs   # osascript Allow/Deny + text-input dialogs
│   ├── focus.mjs    # is the host app frontmost?
│   ├── logger.mjs   # per-channel rolling logs
│   ├── paths.mjs    # ~/.knowtify layout
│   └── io.mjs       # stdin / safe JSON
│
├── claude/      # adapter: PermissionRequest + Stop hooks
│   ├── hooks/   # thin entry points (stdin → orchestrator → stdout)
│   ├── lib/     # pure transformers + orchestrators with injected deps
│   └── scripts/ # patch-settings.mjs (manual, non-plugin install)
│
├── test/        # node:test suites (run orchestrators via fakes — no GUI)
├── install.sh · uninstall.sh   # manual install path
```

**Design principles**
- **Side effects are injected.** Each `lib` orchestrator takes its
  dialog/focus/log/fs dependencies as parameters (defaulting to the real ones),
  so tests drive every decision path without opening a dialog.
- `core/` stays tool-agnostic, so a second adapter could be added later without
  touching it.

## Install

### Claude Code plugin (recommended)

Knowtify is a self-contained Claude Code plugin. From inside Claude Code:

```
/plugin marketplace add Arjun20398/knowtify
/plugin install knowtify@knowtify
```

That's it — Claude registers the `PermissionRequest` + `Stop` hooks for you, no
shell script and no extra setup (GUI backends are detected at runtime). Update
later by re-running `/plugin marketplace add Arjun20398/knowtify`.

### Manual install (no plugin system)

If you'd rather wire it into `~/.claude/settings.json` directly:

```bash
git clone https://github.com/Arjun20398/knowtify ~/.knowtify
bash ~/.knowtify/install.sh
```

Syncs to `~/.knowtify` and registers the `PermissionRequest` + `Stop` hooks in
`~/.claude/settings.json`. See [`claude/README.md`](./claude/README.md) for how
it works.

## Test

```bash
npm test        # node --test
```

## Update

- **Plugin:** re-run `/plugin marketplace add Arjun20398/knowtify` (refreshes the
  marketplace), then `/plugin install knowtify@knowtify`. Run `/reload-plugins`
  to pick up the new hooks in the current session.
- **Manual:** re-run `bash ~/.knowtify/install.sh` (it pulls the latest).

## Uninstall

- **Plugin:** from inside Claude Code —

  ```
  /plugin uninstall knowtify@knowtify
  /plugin marketplace remove knowtify
  ```

- **Manual:**

  ```bash
  bash ~/.knowtify/uninstall.sh
  ```

## Requirements

| | |
|---|---|
| OS | macOS 12 Monterey or later (primary); Linux with `zenity`/`kdialog` (best-effort) |
| Node.js | 18 or later |
| Claude Code | any recent version |

## Why Claude only?

Claude Code's `PermissionRequest` hook **is** the authoritative approver — its
allow/deny response is what Claude acts on, so a native dialog can fully replace
the terminal prompt. Cursor and Windsurf hooks can only *add* a restriction
(deny); their `allow` does not suppress the editor's own approval UI, so an
external dialog can't be the single prompt. Rather than ship a confusing
double-prompt, Knowtify focuses on Claude.
