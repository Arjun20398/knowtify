import fs from 'fs'
import path from 'path'
import { PENDING_DIR, RESPONSES_DIR } from '../paths.mjs'
import { info } from '../logger.mjs'

/**
 * @param {import('../types.mjs').PendingPrompt} prompt
 * @param {import('../types.mjs').ResponseAction} action
 */
export async function respondPermissionRequest(prompt, action) {
  if (action === 'open') return false

  const pendingPath = path.join(PENDING_DIR, `${prompt.id}.json`)
  if (!fs.existsSync(pendingPath)) {
    // May have been created by hook — write response anyway
    info('responding to permission request', { id: prompt.id, action })
  }

  fs.mkdirSync(RESPONSES_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(RESPONSES_DIR, `${prompt.id}.json`),
    JSON.stringify({ action, at: Date.now() }) + '\n',
  )
  return true
}

/**
 * @param {string} promptId
 * @param {import('../types.mjs').ResponseAction} action
 */
export async function respondById(promptId, action) {
  const pendingPath = path.join(PENDING_DIR, `${promptId}.json`)
  let prompt = null
  if (fs.existsSync(pendingPath)) {
    prompt = JSON.parse(fs.readFileSync(pendingPath, 'utf8'))
  }

  if (prompt?.responderType === 'permission-request' || fs.existsSync(pendingPath)) {
    return respondPermissionRequest(
      /** @type {import('../types.mjs').PendingPrompt} */ (
        prompt || { id: promptId, responderType: 'permission-request' }
      ),
      action,
    )
  }
  return false
}
