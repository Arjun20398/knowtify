# core — shared primitives

Tool-agnostic building blocks consumed by the Claude adapter. No tool-specific
logic lives here, so a future adapter could reuse them.

| Module | Responsibility |
|---|---|
| `dialog.mjs` | `showDialog` (Allow/Deny/Allow-All) and `showInputDialog` (text reply) via `osascript`. The "render over any app + collect the answer" layer. |
| `focus.mjs` | `isHostAppFrontmost()` — is the app running this process already focused? |
| `logger.mjs` | `createLogger(channel)` → file-only rolling logger (`~/.knowtify/logs/<channel>.log`). |
| `paths.mjs` | `~/.knowtify` filesystem layout. |
| `io.mjs` | `readStdin()` and `parseJsonSafe()` for hook entry points. |

## Testability

The side-effecting functions (`showDialog`, `showInputDialog`,
`isHostAppFrontmost`) accept an optional `deps` object — e.g. `{ run }` to inject
a fake `spawnSync` — so they can be exercised without spawning real processes.
The Claude adapter injects these into its orchestrators, which is why the whole
decision surface is unit-tested without ever opening a dialog.
