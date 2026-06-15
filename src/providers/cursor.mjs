// Phase 2: Cursor hook / extension events
/** @type {import('../types.mjs').Provider} */
export const cursorProvider = {
  id: 'cursor',
  async detect() {
    return false
  },
  async scan() {
    return []
  },
}
