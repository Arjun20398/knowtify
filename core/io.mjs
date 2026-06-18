/**
 * Read all of stdin as a UTF-8 string. Used by hook entry points to receive
 * the host app's JSON payload.
 * @returns {Promise<string>}
 */
export function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => resolve(data))
  })
}

/**
 * Parse JSON without throwing.
 * @param {string} raw
 * @returns {{ ok: true, value: any } | { ok: false, error: Error }}
 */
export function parseJsonSafe(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (error) {
    return { ok: false, error }
  }
}
