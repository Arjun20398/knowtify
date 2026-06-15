// Phase 3: IDE extension IPC responder
/** @type {import('../types.mjs').Responder} */
export const ideResponder = {
  id: 'ide',
  type: 'ide',

  async respond(_prompt, action) {
    if (action === 'open') {
      // TODO: focus IDE via appBundle
      return false
    }
    return false
  },
}
