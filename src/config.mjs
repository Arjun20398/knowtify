import fs from 'fs'
import { CONFIG_PATH } from './paths.mjs'

const DEFAULTS = {
  pollIntervalMs: 3000,
  renotifyAfterMs: 60_000,
  enabledProviders: ['claude'],
  terminalKeymap: {
    yes: '1',
    'yes-all': '2',
    no: '3',
  },
  logLevel: 'info',
}

/** @returns {typeof DEFAULTS} */
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      return { ...DEFAULTS, ...raw, terminalKeymap: { ...DEFAULTS.terminalKeymap, ...raw.terminalKeymap } }
    }
  } catch {
    // use defaults
  }
  return { ...DEFAULTS }
}

export function saveDefaultConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n')
  }
}
