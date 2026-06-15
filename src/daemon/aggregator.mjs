import fs from 'fs'
import { STATE_PATH } from '../paths.mjs'

/**
 * @typedef {Object} TrackedPrompt
 * @property {import('../types.mjs').PendingPrompt} prompt
 * @property {number} firstSeen
 * @property {number} lastNotified
 */

/**
 * @returns {Record<string, TrackedPrompt>}
 */
export function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    }
  } catch {
    // reset
  }
  return {}
}

/**
 * @param {Record<string, TrackedPrompt>} state
 */
export function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n')
}

/**
 * Merge polled + push prompts, update tracking state.
 * @param {import('../types.mjs').PendingPrompt[]} incoming
 * @param {number} renotifyAfterMs
 * @returns {{ state: Record<string, TrackedPrompt>, toNotify: import('../types.mjs').PendingPrompt[], cleared: string[] }}
 */
export function aggregate(incoming, renotifyAfterMs) {
  const now = Date.now()
  const state = loadState()
  const incomingIds = new Set(incoming.map((p) => p.id))

  /** @type {import('../types.mjs').PendingPrompt[]} */
  const toNotify = []
  /** @type {string[]} */
  const cleared = []

  for (const prompt of incoming) {
    const existing = state[prompt.id]
    if (!existing) {
      state[prompt.id] = { prompt, firstSeen: now, lastNotified: 0 }
      toNotify.push(prompt)
      continue
    }
    existing.prompt = { ...existing.prompt, ...prompt }
    if (now - existing.lastNotified >= renotifyAfterMs) {
      toNotify.push(existing.prompt)
    }
  }

  for (const id of Object.keys(state)) {
    if (!incomingIds.has(id)) {
      cleared.push(id)
      delete state[id]
    }
  }

  return { state, toNotify, cleared }
}

/**
 * @param {Record<string, TrackedPrompt>} state
 * @param {string} id
 */
export function markNotified(state, id) {
  if (state[id]) state[id].lastNotified = Date.now()
}

/**
 * @param {Record<string, TrackedPrompt>} state
 */
export function getActivePrompts(state) {
  return Object.values(state).map((t) => t.prompt)
}
