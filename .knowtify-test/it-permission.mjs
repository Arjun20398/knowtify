// Real Claude permission orchestrator, focus-guard bypassed so the dialog shows.
import path from 'path'
import { fileURLToPath } from 'url'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { handlePermissionRequest } = await import(path.join(REPO, 'claude/lib/permission-request.mjs'))

const input = {
  session_id: 'it-test',
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf ./build', description: 'Clean the build directory' },
  cwd: process.cwd(),
  permission_suggestions: [{ destination: 'localSettings', rules: [{ ruleContent: 'Bash(rm:*)' }] }],
}

const out = await handlePermissionRequest(input, { isHostAppFrontmost: () => false })
console.log('\nJSON Claude would receive:\n' + JSON.stringify(out, null, 2))
