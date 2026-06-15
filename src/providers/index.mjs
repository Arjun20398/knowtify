import fs from 'fs'
import path from 'path'
import { EVENTS_DIR } from '../paths.mjs'
import { claudeProvider } from './claude.mjs'
import { copilotProvider } from './copilot.mjs'
import { cursorProvider } from './cursor.mjs'
import { windsurfProvider } from './windsurf.mjs'

/** @type {import('../types.mjs').Provider[]} */
const ALL_PROVIDERS = [
  claudeProvider,
  cursorProvider,
  windsurfProvider,
  copilotProvider,
]

/**
 * @param {string[]} enabledIds
 * @returns {import('../types.mjs').Provider[]}
 */
export function getProviders(enabledIds) {
  const set = new Set(enabledIds)
  return ALL_PROVIDERS.filter((p) => set.has(p.id))
}

/**
 * Read push events dropped by hooks/extensions (phase 2+).
 * @returns {import('../types.mjs').PendingPrompt[]}
 */
export function readPushEvents() {
  if (!fs.existsSync(EVENTS_DIR)) return []

  const prompts = []
  const files = fs.readdirSync(EVENTS_DIR).filter((f) => f.endsWith('.json'))
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, file), 'utf8'))
      if (raw?.id && raw?.tool) prompts.push(raw)
    } catch {
      // skip corrupt events
    }
  }
  return prompts
}

/**
 * @param {import('../types.mjs').Provider[]} providers
 * @returns {Promise<import('../types.mjs').ProviderScanResult[]>}
 */
export async function scanAll(providers) {
  const results = []
  for (const provider of providers) {
    try {
      const available = await provider.detect()
      if (!available) {
        results.push({ providerId: provider.id, available: false, prompts: [] })
        continue
      }
      const prompts = await provider.scan()
      results.push({ providerId: provider.id, available: true, prompts })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({
        providerId: provider.id,
        available: true,
        prompts: [],
        error: message,
      })
    }
  }
  return results
}
