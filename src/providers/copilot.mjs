// Phase 2: Copilot CLI heuristic detection
/** @type {import('../types.mjs').Provider} */
export const copilotProvider = {
  id: 'copilot',
  async detect() {
    return false
  },
  async scan() {
    return []
  },
}
