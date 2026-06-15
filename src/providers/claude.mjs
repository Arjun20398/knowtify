import { execFile } from 'child_process'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** @type {import('../types.mjs').Provider} */
export const claudeProvider = {
  id: 'claude',

  async detect() {
    try {
      await execFileAsync('which', ['claude'])
      return true
    } catch {
      return false
    }
  },

  async scan() {
    try {
      const { stdout } = await execFileAsync('claude', ['agents', '--json'], {
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
      })
      const sessions = JSON.parse(stdout.trim() || '[]')
      if (!Array.isArray(sessions)) return []

      /** @type {import('../types.mjs').PendingPrompt[]} */
      const prompts = []

      for (const session of sessions) {
        if (session.status !== 'waiting') continue

        const waitingFor = session.waitingFor || 'input'
        const project = path.basename(session.cwd || 'unknown')
        const id = `claude:${session.sessionId}:${waitingFor}`

        prompts.push({
          id,
          tool: 'claude',
          project,
          summary: waitingFor,
          pid: session.pid,
          sessionId: session.sessionId,
          cwd: session.cwd,
          responderType: 'terminal',
          waitingSince: Date.now(),
        })
      }

      return prompts
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('ENOENT') || message.includes('not found')) {
        return []
      }
      throw new Error(`claude provider scan failed: ${message}`)
    }
  },
}
