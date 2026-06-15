import fs from 'fs'
import { LOG_PATH } from './paths.mjs'

function stamp() {
  return new Date().toISOString()
}

export function log(level, msg, extra) {
  const line = extra
    ? `[${stamp()}] ${level.toUpperCase()} ${msg} ${JSON.stringify(extra)}`
    : `[${stamp()}] ${level.toUpperCase()} ${msg}`
  if (level === 'error') console.error(line)
  else console.log(line)
  try {
    fs.appendFileSync(LOG_PATH, line + '\n')
  } catch {
    // ignore if log dir missing
  }
}

export const info = (msg, extra) => log('info', msg, extra)
export const warn = (msg, extra) => log('warn', msg, extra)
export const error = (msg, extra) => log('error', msg, extra)
export const debug = (msg, extra) => log('debug', msg, extra)
