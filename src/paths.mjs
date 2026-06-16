import fs from 'fs'
import os from 'os'
import path from 'path'

export const HOME = os.homedir()
export const ROOT = path.join(HOME, '.knowtify')
export const CONFIG_PATH = path.join(ROOT, 'config.json')
export const STATE_PATH = path.join(ROOT, 'state.json')
export const PID_PATH = path.join(ROOT, 'knowtify.pid')
export const EVENTS_DIR = path.join(ROOT, 'events')
export const RESPONSES_DIR = path.join(ROOT, 'responses')
export const PENDING_DIR = path.join(ROOT, 'pending')
export const LOGS_DIR = path.join(ROOT, 'logs')
export const LOG_PATH = path.join(LOGS_DIR, 'knowtify.log')

export function ensureDirs() {
  for (const dir of [ROOT, EVENTS_DIR, RESPONSES_DIR, PENDING_DIR, LOGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
