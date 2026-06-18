// Real Claude Stop orchestrator, focus-guard bypassed + canned transcript.
import path from 'path'
import { fileURLToPath } from 'url'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { handleStop } = await import(path.join(REPO, 'claude/lib/stop.mjs'))

const out = handleStop(
  { session_id: 'it-test', cwd: process.cwd(), transcript_path: '/dev/null' },
  {
    isHostAppFrontmost: () => false,
    readTranscript: () => 'I can store sessions in Redis or in-memory.\nWhich approach do you prefer?',
    log: () => {},
  },
)
console.log('\nJSON Claude would receive:\n' + JSON.stringify(out, null, 2))
