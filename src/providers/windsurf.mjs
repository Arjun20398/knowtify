// Phase 2: Windsurf hook / extension events
/** @type {import('../types.mjs').Provider} */
export const windsurfProvider = {
  id: 'windsurf',
  async detect() {
    return false
  },
  async scan() {
    return []
  },
}
