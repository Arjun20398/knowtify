/**
 * @typedef {'yes' | 'yes-all' | 'no' | 'open'} ResponseAction
 */

/**
 * @typedef {Object} PromptChoice
 * @property {string} id
 * @property {string} label
 * @property {string} action
 */

/**
 * @typedef {Object} PendingPrompt
 * @property {string} id
 * @property {string} tool
 * @property {string} project
 * @property {string} summary
 * @property {string} [toolName]
 * @property {string} [command]
 * @property {string} [description]
 * @property {number} [pid]
 * @property {string} [tty]
 * @property {string} [sessionId]
 * @property {string} [cwd]
 * @property {string} [appBundle]
 * @property {'terminal' | 'ide' | 'permission-request'} responderType
 * @property {PromptChoice[]} [choices]
 * @property {Record<string, unknown>} [hookInput]
 * @property {number} waitingSince
 */

/**
 * @typedef {Object} ProviderScanResult
 * @property {string} providerId
 * @property {boolean} available
 * @property {PendingPrompt[]} prompts
 * @property {string} [error]
 */

/**
 * @typedef {Object} Provider
 * @property {string} id
 * @property {() => Promise<boolean>} detect
 * @property {() => Promise<PendingPrompt[]>} scan
 */

/**
 * @typedef {Object} Responder
 * @property {string} id
 * @property {'terminal' | 'ide'} type
 * @property {(prompt: PendingPrompt, action: ResponseAction) => Promise<boolean>} respond
 */

export {}
