// Real Cursor approval orchestrator; dedupe collapsed to a single inline run.
import path from 'path'
import { fileURLToPath } from 'url'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { handleApproval, allowResponse, denyResponse } = await import(path.join(REPO, 'cursor/lib/approval.mjs'))

const decision = handleApproval(
  { command: 'rm -rf ./build', cwd: process.cwd(), generation_id: 'it-test' },
  { dedupe: (_i, fn) => fn(), log: () => {} },
)
const response = decision === 'allow' ? allowResponse() : denyResponse()
console.log('\ndecision:', decision)
console.log('JSON Cursor would receive:\n' + JSON.stringify(response, null, 2))
