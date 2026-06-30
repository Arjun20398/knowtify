---
description: Switch Knowtify between blocking dialogs and non-blocking notifications
argument-hint: [notify|dialog]
allowed-tools: Bash(node:*)
---

You are setting the user's Knowtify notification style. Run the script below and
report its output to the user verbatim — do not take any further action.

!`node "${CLAUDE_PLUGIN_ROOT}/claude/scripts/set-style.mjs" "$ARGUMENTS"`

Notes:
- `notify` = a non-blocking banner ("Claude is waiting…"); Knowtify then defers
  to the terminal prompt. `dialog` (default) = a blocking dialog you act on.
- If no argument was passed, the script prints the current style; let the user
  know they can run `/knowtify:style notify` or `/knowtify:style dialog`.
- The change takes effect on the next turn; no restart needed.
