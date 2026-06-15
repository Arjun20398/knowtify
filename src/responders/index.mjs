import { ideResponder } from './ide.mjs'
import { respondById, respondPermissionRequest } from './permission-request.mjs'
import { terminalResponder } from './terminal.mjs'

/** @type {import('../types.mjs').Responder[]} */
const ALL_RESPONDERS = [terminalResponder, ideResponder]

/**
 * @param {'terminal' | 'ide' | 'permission-request'} type
 * @returns {import('../types.mjs').Responder | undefined}
 */
export function getResponder(type) {
  if (type === 'permission-request') {
    return {
      id: 'permission-request',
      type: 'permission-request',
      respond: respondPermissionRequest,
    }
  }
  return ALL_RESPONDERS.find((r) => r.type === type)
}

/**
 * @param {import('../types.mjs').PendingPrompt} prompt
 * @param {import('../types.mjs').ResponseAction} action
 */
export async function dispatchResponse(prompt, action) {
  const responder = getResponder(prompt.responderType)
  if (!responder) return false
  return responder.respond(prompt, action)
}

export { respondById }
