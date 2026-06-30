---
description: Control whether Knowtify alerts you even when the app is already frontmost
argument-hint: [unfocused|always]
allowed-tools: Bash(node:*)
---

You are setting when Knowtify speaks up relative to focus. Run the script below
and report its output to the user verbatim — do not take any further action.

!`node "${CLAUDE_PLUGIN_ROOT}/claude/scripts/set-notify-when.mjs" "$ARGUMENTS"`

Notes:
- `unfocused` (default) = stay quiet when Claude's window is already frontmost.
  `always` = also alert when frontmost — the only way to hear about a Claude
  finishing in a *background terminal tab* of the focused window (tabs aren't
  separate OS windows, so focus detection can't tell them apart).
- With `always`, focus picks the channel: a non-blocking **banner** while you're
  focused on the window (a modal would interrupt you), and your configured
  `style` (dialog/notify) when the window is in the **background**.
- If no argument was passed, the script prints the current value; let the user
  know they can run `/knowtify:notify-when always` or `/knowtify:notify-when unfocused`.
- The change takes effect on the next turn; no restart needed.
