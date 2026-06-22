import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRequestId, buildChoices, buildPrompt, buildHookOutput, handlePermissionRequest,
  buildQuestionBody, collectAnswers, handleAskUserQuestion,
} from '../claude/lib/permission-request.mjs'
import {
  looksLikeQuestion, readLastAssistantMessage, forDisplay, handleStop,
  formatDuration, completionLabel, readTurnDurationMs, parseOptions,
} from '../claude/lib/stop.mjs'

// ── permission: pure ──
test('buildRequestId: stable + format', () => {
  const input = { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } }
  assert.equal(buildRequestId(input), buildRequestId(input))
  assert.match(buildRequestId(input), /^s1:Bash:[0-9a-f]{8}$/)
})
test('buildChoices: no suggestions → session-wide', () => {
  const c = buildChoices({ tool_name: 'Bash' })
  assert.deepEqual(c.map(x => x.id), ['yes', 'yes-all', 'no'])
  assert.match(c[1].label, /allow all for this session/i)
})
test('buildChoices: with suggestion → ruleContent + destination', () => {
  const c = buildChoices({ tool_name: 'Bash', permission_suggestions: [{ destination: 'localSettings', rules: [{ ruleContent: 'npm test' }] }] })
  assert.match(c[1].label, /npm test/)
  assert.match(c[1].label, /this project/)
})
test('buildPrompt: project basename + detail', () => {
  const p = buildPrompt({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd: '/a/b/foo' })
  assert.equal(p.project, 'foo')
  assert.match(p.detail, /echo hi/)
})
test('buildHookOutput: no → deny', () => {
  assert.equal(buildHookOutput({ hookInput: {} }, 'no').hookSpecificOutput.decision.behavior, 'deny')
})
test('buildHookOutput: yes → allow, no updatedPermissions', () => {
  const d = buildHookOutput({ hookInput: {} }, 'yes').hookSpecificOutput.decision
  assert.equal(d.behavior, 'allow')
  assert.equal(d.updatedPermissions, undefined)
})
test('buildHookOutput: yes-all w/o suggestion → acceptEdits', () => {
  const d = buildHookOutput({ hookInput: {} }, 'yes-all').hookSpecificOutput.decision
  assert.deepEqual(d.updatedPermissions, [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])
})
test('buildHookOutput: yes-all w/ suggestion → passthrough', () => {
  const sug = { destination: 'session', rules: [{ ruleContent: 'ls' }] }
  const d = buildHookOutput({ hookInput: { permission_suggestions: [sug] } }, 'yes-all').hookSpecificOutput.decision
  assert.deepEqual(d.updatedPermissions, [sug])
})

// ── permission: orchestrator (DI) ──
const baseInput = { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/a/b/foo' }
test('handlePermissionRequest: frontmost → null (defers)', async () => {
  const out = await handlePermissionRequest(baseInput, { isHostAppFrontmost: () => true, showDialog: () => { throw new Error('should not show') } })
  assert.equal(out, null)
})
test('handlePermissionRequest: allow → yes output', async () => {
  const out = await handlePermissionRequest(baseInput, { isHostAppFrontmost: () => false, showDialog: () => ({ result: 'allow', meta: {} }) })
  assert.equal(out.hookSpecificOutput.decision.behavior, 'allow')
})
test('handlePermissionRequest: deny → no output', async () => {
  const out = await handlePermissionRequest(baseInput, { isHostAppFrontmost: () => false, showDialog: () => ({ result: 'deny', meta: {} }) })
  assert.equal(out.hookSpecificOutput.decision.behavior, 'deny')
})
test('handlePermissionRequest: allow-all → updatedPermissions', async () => {
  const out = await handlePermissionRequest(baseInput, { isHostAppFrontmost: () => false, showDialog: () => ({ result: 'allow-all', meta: {} }) })
  assert.ok(out.hookSpecificOutput.decision.updatedPermissions)
})
test('handlePermissionRequest: no GUI (unavailable) → null (defers, never denies)', async () => {
  const out = await handlePermissionRequest(baseInput, { isHostAppFrontmost: () => false, showDialog: () => ({ result: 'unavailable', meta: {} }) })
  assert.equal(out, null)
})

// ── AskUserQuestion ──
const askInput = {
  tool_name: 'AskUserQuestion',
  cwd: '/a/b/foo',
  tool_input: {
    questions: [{
      question: 'Which approach?',
      header: 'API design',
      multiSelect: false,
      options: [
        { label: 'Keep GET', description: 'use query params' },
        { label: 'POST + JSON', description: 'request body' },
      ],
    }],
  },
}
const okChoice = (labels) => () => ({ result: 'ok', selected: labels, meta: {} })

test('buildQuestionBody: question text + bulleted options', () => {
  const body = buildQuestionBody(askInput.tool_input.questions[0])
  assert.match(body, /Which approach\?/)
  assert.match(body, /• Keep GET — use query params/)
  assert.match(body, /• POST \+ JSON — request body/)
})
test('handleAskUserQuestion: routed via handlePermissionRequest', async () => {
  const out = await handlePermissionRequest(askInput, {
    isHostAppFrontmost: () => false,
    showChoiceDialog: okChoice(['Keep GET']),
  })
  assert.equal(out.hookSpecificOutput.decision.behavior, 'allow')
  assert.deepEqual(out.hookSpecificOutput.decision.updatedInput.answers, { 'Which approach?': 'Keep GET' })
  assert.ok(Array.isArray(out.hookSpecificOutput.decision.updatedInput.questions))
})
test('handleAskUserQuestion: frontmost → null', () => {
  assert.equal(handleAskUserQuestion(askInput, { isHostAppFrontmost: () => true }), null)
})
test('handleAskUserQuestion: no questions → null', () => {
  assert.equal(handleAskUserQuestion({ tool_name: 'AskUserQuestion', tool_input: {} }, { isHostAppFrontmost: () => false }), null)
})
test('handleAskUserQuestion: dialog unavailable → focuses + null (defers)', () => {
  let focused = false
  const out = handleAskUserQuestion(askInput, {
    isHostAppFrontmost: () => false,
    focusHostApp: () => { focused = true; return true },
    showChoiceDialog: () => ({ result: 'unavailable', selected: [], meta: {} }),
  })
  assert.equal(out, null)
  assert.equal(focused, true)
})
test('handleAskUserQuestion: dismissed → focuses + null', () => {
  let focused = false
  const out = handleAskUserQuestion(askInput, {
    isHostAppFrontmost: () => false,
    focusHostApp: () => { focused = true; return true },
    showChoiceDialog: () => ({ result: 'cancel', selected: [], meta: {} }),
  })
  assert.equal(out, null)
  assert.equal(focused, true)
})
test('handleAskUserQuestion: Other → focuses Claude window + null (defers)', () => {
  let focused = false
  const out = handleAskUserQuestion(askInput, {
    isHostAppFrontmost: () => false,
    focusHostApp: () => { focused = true; return true },
    showChoiceDialog: okChoice(['✎ Other (let me type in Claude)…']),
  })
  assert.equal(out, null)
  assert.equal(focused, true)
})
test('collectAnswers: multi-select joins labels with comma', () => {
  const q = [{ question: 'Pick features', header: 'Feat', multiSelect: true, options: [{ label: 'Logs' }, { label: 'Metrics' }] }]
  const answers = collectAnswers(q, { showChoiceDialog: okChoice(['Logs', 'Metrics']), header: 'foo' })
  assert.deepEqual(answers, { 'Pick features': 'Logs, Metrics' })
})
test('collectAnswers: Other → null (defers to Claude window)', () => {
  const q = [{ question: 'Which?', header: 'H', options: [{ label: 'A' }] }]
  const answers = collectAnswers(q, {
    showChoiceDialog: okChoice(['✎ Other (let me type in Claude)…']),
    header: 'foo',
  })
  assert.equal(answers, null)
})

// ── stop: pure ──
for (const m of ['What now?', 'Should I proceed?', 'a\nb\nWhich do you prefer', 'Use Redis or memory. Let me know.'])
  test(`looksLikeQuestion true: ${JSON.stringify(m.slice(0, 30))}`, () => assert.equal(looksLikeQuestion(m), true))
for (const m of ['Done.', 'I finished the task.', '', 'Tests pass and code shipped.'])
  test(`looksLikeQuestion false: ${JSON.stringify(m.slice(0, 30))}`, () => assert.equal(looksLikeQuestion(m), false))

test('readLastAssistantMessage: last assistant text, skips later user + tool-only', () => {
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Which option?' }] } },
    { type: 'user', message: { content: [{ type: 'text', text: 'noise' }] } },
  ].map(o => JSON.stringify(o)).join('\n')
  const io = { existsSync: () => true, readFileSync: () => lines }
  assert.equal(readLastAssistantMessage('/x', io), 'Which option?')
})
test('readLastAssistantMessage: missing file → empty', () => {
  assert.equal(readLastAssistantMessage('/x', { existsSync: () => false }), '')
})
test('forDisplay: long text keeps tail', () => {
  const out = forDisplay('x'.repeat(2000), 100)
  assert.ok(out.startsWith('…\n'))
  assert.ok(out.length <= 102)
})

// ── stop: orchestrator (DI) ──
const stopInput = { cwd: '/a/b/foo', transcript_path: '/t.jsonl' }
const notFront = () => false
test('handleStop: frontmost → null (no notification)', () => {
  let notified = false
  const out = handleStop(stopInput, { isHostAppFrontmost: () => true, showNotification: () => { notified = true; return true }, log: () => {} })
  assert.equal(out, null)
  assert.equal(notified, false)
})
test('handleStop: not a question → null + fires "✻ Clauding for Ns" banner with sound', () => {
  let note
  const out = handleStop(stopInput, {
    isHostAppFrontmost: notFront,
    readTranscript: () => 'All done. Tests pass.',
    readDurationMs: () => 20_000,
    showNotification: (n) => { note = n; return true },
    log: () => {},
  })
  assert.equal(out, null)
  assert.equal(note.title, '✻ Clauding for 20s')
  assert.equal(note.message, 'foo')
  assert.equal(note.sound, 'Glass')
})

// ── duration / label ──
test('formatDuration: seconds / minutes / hours', () => {
  assert.equal(formatDuration(20_000), '20s')
  assert.equal(formatDuration(65_000), '1m 5s')
  assert.equal(formatDuration(120_000), '2m')
  assert.equal(formatDuration(3_660_000), '1h 1m')
})
test('completionLabel: with and without duration', () => {
  assert.equal(completionLabel(20_000), '✻ Clauding for 20s')
  assert.equal(completionLabel(null), '✻ Clauding')
})
test('readTurnDurationMs: ignores stale turn_duration entry, uses timestamps', () => {
  // The CLI writes turn_duration AFTER the Stop hook, so any value present is a
  // prior turn's — must be ignored in favor of this turn's prompt→answer span.
  const lines = [
    { type: 'system', subtype: 'turn_duration', durationMs: 999999 }, // previous turn, stale
    { type: 'user', timestamp: '2026-06-18T10:00:00.000Z', message: { content: [{ type: 'text', text: 'go' }] } },
    { type: 'assistant', timestamp: '2026-06-18T10:00:20.000Z', message: { content: [{ type: 'text', text: 'done' }] } },
  ].map(o => JSON.stringify(o)).join('\n')
  const io = { existsSync: () => true, readFileSync: () => lines }
  assert.equal(readTurnDurationMs('/x', io), 20_000)
})
test('readTurnDurationMs: skips sidechain entries', () => {
  const lines = [
    { type: 'user', timestamp: '2026-06-18T10:00:00.000Z', message: { content: [{ type: 'text', text: 'go' }] } },
    { type: 'assistant', isSidechain: true, timestamp: '2026-06-18T10:05:00.000Z', message: { content: [{ type: 'text', text: 'subagent' }] } },
    { type: 'assistant', timestamp: '2026-06-18T10:00:20.000Z', message: { content: [{ type: 'text', text: 'done' }] } },
  ].map(o => JSON.stringify(o)).join('\n')
  const io = { existsSync: () => true, readFileSync: () => lines }
  assert.equal(readTurnDurationMs('/x', io), 20_000)
})
test('readTurnDurationMs: falls back to timestamps (last user prompt → last assistant)', () => {
  const lines = [
    { type: 'user', timestamp: '2026-06-18T10:00:00.000Z', message: { content: [{ type: 'text', text: 'go' }] } },
    { type: 'assistant', timestamp: '2026-06-18T10:00:05.000Z', message: { content: [{ type: 'tool_use' }] } },
    { type: 'user', timestamp: '2026-06-18T10:00:06.000Z', message: { content: [{ type: 'tool_result' }] } },
    { type: 'assistant', timestamp: '2026-06-18T10:00:20.000Z', message: { content: [{ type: 'text', text: 'done' }] } },
  ].map(o => JSON.stringify(o)).join('\n')
  const io = { existsSync: () => true, readFileSync: () => lines }
  assert.equal(readTurnDurationMs('/x', io), 20_000) // tool_result user ignored
})
test('readTurnDurationMs: missing file → null', () => {
  assert.equal(readTurnDurationMs('/x', { existsSync: () => false }), null)
})
test('handleStop: question + "Open Claude" → focuses window, null', () => {
  let focused = false
  const out = handleStop(stopInput, {
    isHostAppFrontmost: notFront,
    readTranscript: () => 'Which approach do you prefer?',
    showDialog: () => ({ result: 'allow', meta: {} }),
    focusHostApp: () => { focused = true; return true },
    log: () => {},
  })
  assert.equal(out, null)
  assert.equal(focused, true)
})
test('handleStop: question but dismissed → null, no focus', () => {
  let focused = false
  const out = handleStop(stopInput, {
    isHostAppFrontmost: notFront,
    readTranscript: () => 'Which approach?',
    showDialog: () => ({ result: 'deny', meta: {} }),
    focusHostApp: () => { focused = true; return true },
    log: () => {},
  })
  assert.equal(out, null)
  assert.equal(focused, false)
})

// ── stop: parseOptions ──
test('parseOptions: letter options → question + options', () => {
  const r = parseOptions('What is 2 + 2?\n\nA. 3\nB. 4\nC. 5\nD. 22')
  assert.equal(r.question, 'What is 2 + 2?')
  assert.deepEqual(r.options, ['A. 3', 'B. 4', 'C. 5', 'D. 22'])
})
test('parseOptions: numbered + paren styles', () => {
  const r = parseOptions('Pick one:\n1) Redis\n2) In-memory')
  assert.deepEqual(r.options, ['1) Redis', '2) In-memory'])
  assert.equal(r.question, 'Pick one:')
})
test('parseOptions: fewer than 2 options → null', () => {
  assert.equal(parseOptions('Just one thing?\nA. only'), null)
})
test('parseOptions: prose with no enumeration → null', () => {
  assert.equal(parseOptions('Which approach do you prefer?'), null)
})

// ── stop: option-button path ──
const optMsg = 'What is 2 + 2?\n\nA. 3\nB. 4\nC. 5\nD. 22'
test('handleStop: option picked → injects it via decision:block', () => {
  let usedPlain = false
  const out = handleStop(stopInput, {
    isHostAppFrontmost: notFront,
    readTranscript: () => optMsg,
    showOptionsDialog: () => ({ result: 'option', index: 1, label: 'B. 4', meta: {} }),
    showDialog: () => { usedPlain = true; return { result: 'deny', meta: {} } },
    log: () => {},
  })
  assert.deepEqual(out, { decision: 'block', reason: 'B. 4' })
  assert.equal(usedPlain, false)
})
test('handleStop: options + Open Claude → focuses, null', () => {
  let focused = false
  const out = handleStop(stopInput, {
    isHostAppFrontmost: notFront,
    readTranscript: () => optMsg,
    showOptionsDialog: () => ({ result: 'open', meta: {} }),
    focusHostApp: () => { focused = true; return true },
    log: () => {},
  })
  assert.equal(out, null)
  assert.equal(focused, true)
})
test('handleStop: options + Dismiss → null', () => {
  const out = handleStop(stopInput, {
    isHostAppFrontmost: notFront,
    readTranscript: () => optMsg,
    showOptionsDialog: () => ({ result: 'dismiss', meta: {} }),
    log: () => {},
  })
  assert.equal(out, null)
})
test('handleStop: options backend unavailable → falls back to plain dialog', () => {
  let usedPlain = false
  const out = handleStop(stopInput, {
    isHostAppFrontmost: notFront,
    readTranscript: () => optMsg,
    showOptionsDialog: () => ({ result: 'unavailable', meta: {} }),
    showDialog: () => { usedPlain = true; return { result: 'deny', meta: {} } },
    log: () => {},
  })
  assert.equal(out, null)
  assert.equal(usedPlain, true)
})
