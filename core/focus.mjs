import { spawnSync } from 'child_process'
import { getPlatformConfig } from './platform.mjs'

/**
 * Returns true if the GUI app running our parent process is currently the
 * frontmost window — i.e. the user is already watching the agent, so a popup
 * would be redundant.
 *
 * Always fails open (returns false → "not frontmost → show the dialog"): if we
 * can't determine focus we'd rather pop a possibly-redundant dialog than
 * silently swallow a prompt.
 *
 * @param {{ run?: typeof spawnSync, platform?: import('./platform.mjs').PlatformConfig }} [deps]
 */
export function isHostAppFrontmost(deps = {}) {
  const run = deps.run ?? spawnSync
  const cfg = deps.platform ?? getPlatformConfig()
  try {
    if (cfg.focus?.tool === 'osascript') return frontmostOsascript(run, cfg.focus.path)
    if (cfg.focus?.tool === 'xdotool')   return frontmostXdotool(run, cfg.focus.path)
  } catch { /* fail open */ }
  return false
}

/**
 * Snapshot the whole process table in a single `ps` call →
 * Map<pid, { ppid, comm }>. This replaces walking the tree one `ps` spawn per
 * ancestor level, which was the dominant latency on the (common) path where the
 * host app is NOT frontmost and we go on to notify — there the walk runs its
 * full length because nothing matches.
 * @returns {Map<number, { ppid: number, comm: string }>}
 */
function processTable(run) {
  const table = new Map()
  const r = run('ps', ['-Ao', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 3000 })
  if (r.status !== 0) return table
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!m) continue
    table.set(parseInt(m[1], 10), { ppid: parseInt(m[2], 10), comm: m[3].toLowerCase() })
  }
  return table
}

/**
 * Walk our ancestor pids (closest first) in memory from a process-table
 * snapshot, stopping at init or `max` levels.
 * @returns {number[]}
 */
function ancestorPidsFrom(table, startPid = process.ppid, max = 20) {
  const pids = []
  let pid = startPid
  for (let i = 0; i < max; i++) {
    if (!pid || pid <= 1) break
    pids.push(pid)
    const entry = table.get(pid)
    if (!entry) break
    pid = entry.ppid
  }
  return pids
}

/**
 * Collect our ancestor process pids (parent, grandparent, …) up to `max` levels,
 * stopping at init. Shared by focus detection and window activation. One `ps`
 * snapshot, walked in memory.
 * @returns {number[]} closest ancestor first
 */
function ancestorPids(run, max = 12) {
  return ancestorPidsFrom(processTable(run), process.ppid, max)
}

/**
 * Our ancestor processes as `{ pid, comm }` pairs (closest first), from one `ps`
 * snapshot. `comm` is the lowercased command (path or name) as `ps` reports it.
 * The dialog layer uses this to let a modal auto-dismiss itself when the host app
 * returns to the foreground — matching either by pid (terminals, whose app pid is
 * in our tree) or by name (editors like Cursor/VSCode, whose frontmost app pid is
 * usually NOT an ancestor, so we fall back to name matching like
 * {@link isHostAppFrontmost} does). Never throws; returns [] on failure.
 * @param {{ run?: typeof spawnSync }} [deps]
 * @returns {{ pid: number, comm: string }[]}
 */
export function getAncestorProcs(deps = {}) {
  const run = deps.run ?? spawnSync
  try {
    const table = processTable(run)
    return ancestorPidsFrom(table, process.ppid, 20)
      .map(pid => ({ pid, comm: table.get(pid)?.comm || '' }))
  } catch {
    return []
  }
}

/**
 * Distinct GUI-app name tokens from a list of ancestor `{ pid, comm }` pairs —
 * the basename of each `comm`, minus shells / interpreters / our own tooling that
 * are never the frontmost GUI app and whose short names ("sh", "node") would
 * cause false matches. Used to detect "the host app is frontmost" from inside a
 * modal by substring-matching the frontmost app's display name.
 * @param {{ pid: number, comm: string }[]} procs
 * @returns {string[]}
 */
export function hostAppNames(procs) {
  const skip = new Set([
    'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh',
    'node', 'deno', 'bun', 'python', 'python3', 'ruby', 'perl',
    'login', 'tmux', 'screen', 'ssh', 'sshd', 'claude', 'env', 'sudo',
  ])
  const names = []
  for (const { comm } of procs || []) {
    if (!comm) continue
    // Basename, and drop a leading '-' (login shells show as "-zsh").
    let name = comm.split('/').pop().replace(/^-/, '')
    if (!name || name.length < 3) continue
    if (skip.has(name)) continue
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Walk up our process tree looking for an ancestor whose pid matches `targetPid`.
 * @returns {boolean}
 */
function ancestorPidMatches(run, targetPid) {
  return ancestorPids(run, 20).includes(targetPid)
}

/**
 * Bring the GUI app hosting Claude (terminal / editor) to the front. Called when
 * Claude needs the user to type a reply: instead of capturing free text in a
 * cramped dialog, Knowtify alerts the user and jumps them back to the real
 * window where Claude's own input is.
 *
 * Best-effort: returns true if an activation was issued, false otherwise (no
 * focus backend, no GUI ancestor, or the command failed). Never throws.
 *
 * @param {{ run?: typeof spawnSync, platform?: import('./platform.mjs').PlatformConfig }} [deps]
 * @returns {boolean}
 */
export function focusHostApp(deps = {}) {
  const run = deps.run ?? spawnSync
  const cfg = deps.platform ?? getPlatformConfig()
  try {
    if (cfg.focus?.tool === 'osascript') return activateOsascript(run, cfg.focus.path)
    if (cfg.focus?.tool === 'xdotool')   return activateXdotool(run, cfg.focus.path)
  } catch { /* best effort */ }
  return false
}

/**
 * macOS — activate the nearest ancestor that's a real GUI application.
 * NSRunningApplication returns missing value for shells/node, so the first hit
 * walking up is the terminal/editor. Uses NSRunningApplication's activate API,
 * which (unlike `tell application "X"` or System Events) needs no Automation or
 * Accessibility permission. Option 3 = AllWindows | IgnoringOtherApps.
 */
function activateOsascript(run, bin) {
  const pids = ancestorPids(run)
  if (!pids.length) return false
  const script = `
use framework "Foundation"
use framework "AppKit"
set theApp to current application
repeat with p in {${pids.join(', ')}}
  set ra to theApp's NSRunningApplication's runningApplicationWithProcessIdentifier:(p as integer)
  if ra is not missing value then
    ra's activateWithOptions:3
    return "ok"
  end if
end repeat
return "none"
`
  const r = run(bin, ['-e', script], { encoding: 'utf8', timeout: 5000 })
  return r.status === 0 && (r.stdout || '').trim() === 'ok'
}

/** Linux/X11 — raise the first window owned by one of our ancestor pids. */
function activateXdotool(run, bin) {
  for (const pid of ancestorPids(run)) {
    const s = run(bin, ['search', '--pid', String(pid)], { encoding: 'utf8', timeout: 3000 })
    if (s.status !== 0) continue
    const winId = (s.stdout || '').trim().split('\n').filter(Boolean)[0]
    if (!winId) continue
    const a = run(bin, ['windowactivate', winId], { encoding: 'utf8', timeout: 3000 })
    if (a.status === 0) return true
  }
  return false
}

/**
 * macOS — compare the frontmost app name against our ancestor process names.
 * Uses `path to frontmost application` (Standard Addition, no permissions).
 */
function frontmostOsascript(run, bin) {
  const frontResult = run(bin, ['-e', 'path to frontmost application as text'], {
    encoding: 'utf8', timeout: 3000,
  })
  if (frontResult.status !== 0) return false

  // Path like "Macintosh HD:Applications:IntelliJ IDEA CE.app:"
  const frontPath  = (frontResult.stdout || '').trim().toLowerCase()
  const frontMatch = frontPath.match(/:([^:]+)\.app:?$/)
  if (!frontMatch) return false
  const frontAppName = frontMatch[1] // e.g. "intellij idea ce", "iterm", "warp"

  // One ps snapshot, then compare each ancestor's command against the front app.
  const table = processTable(run)
  let pid = process.ppid
  for (let i = 0; i < 10; i++) {
    const entry = table.get(pid)
    if (!entry) break
    if (entry.comm.includes(frontAppName) || frontAppName.includes(entry.comm)) return true
    if (entry.ppid <= 1) break
    pid = entry.ppid
  }
  return false
}

/**
 * Linux/X11 — the active window's owning pid should be one of our ancestors
 * (terminal emulator / editor → shell → claude → us). Wayland has no portable
 * query, so xdotool fails there and we fall open to "not frontmost".
 */
function frontmostXdotool(run, bin) {
  const r = run(bin, ['getactivewindow', 'getwindowpid'], { encoding: 'utf8', timeout: 3000 })
  if (r.status !== 0) return false
  const activePid = parseInt((r.stdout || '').trim(), 10)
  if (!activePid) return false
  return ancestorPidMatches(run, activePid)
}
