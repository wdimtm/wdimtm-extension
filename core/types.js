/**
 * Shared contracts for WDIMTM.
 *
 * Dogfood architecture (single-shot first):
 *   selection + bounded page + profile + memories + lens + mode
 *     → one model call (openai-compatible recommended)
 *     → structured personalized response
 *
 * Runtimes: mock | openai-compatible | promptaas
 * PromptaaS is optional — not required for ordinary Explain.
 *
 * @typedef {'mock' | 'openai-compatible' | 'promptaas'} RuntimeKind
 *
 * @typedef {
 *   | 'explain'
 *   | 'more'
 *   | 'simplify'
 *   | 'why_it_matters'
 *   | 'verify'
 *   | 'research'
 *   | 'opportunity'
 *   | 'probe'
 *   | 'summarize'
 *   | 'summarize-page'
 * } ExplainMode
 *
 * // Legacy UI aliases accepted by normalizeMode(): why → why_it_matters
 *
 * @typedef {Object} PageContext
 * @property {string} url
 * @property {string} title
 * @property {string} [context]  // bounded neighborhood, never full DOM
 *
 * @typedef {Object} Lens
 * @property {string} id
 * @property {string} [instructions]
 *
 * @typedef {Object} MemoryItem
 * @property {string} type  // profile | interest | preference | knowledge | goal | note
 * @property {string} content
 *
 * @typedef {Object} ExplainRequest
 * @property {string} selection
 * @property {PageContext} page
 * @property {Lens} [lens]
 * @property {MemoryItem[]} [memories]
 * @property {string} [profile]  // stable user self-description (optional; may also appear in memories as type=profile)
 * @property {ExplainMode | string} [mode]
 * @property {string} [answerLanguage]
 * @property {string} [answerDepth]  // short | normal | detailed
 * @property {string} [languageInstruction]
 * @property {string} [followUpQuestion]  // for mode=probe
 *
 * @typedef {Object} FollowUpAction
 * @property {string} id
 * @property {string} label
 * @property {string} intent  // more | why | verify | remember | discuss | probe | …
 * @property {string} [question]
 *
 * @typedef {Object} MemorySuggestion
 * @property {string} content  // durable, standalone fact about the user — not full answer dump
 * @property {'interest' | 'preference' | 'knowledge' | 'goal' | 'note' | string} type
 * @property {string} [reason]
 *
 * @typedef {Object} ExplainResponseMeta
 * @property {ExplainMode | string} [mode]
 * @property {string} [lensId]
 * @property {'none' | 'light' | 'rich'} [personalization]
 * @property {'single_shot' | 'tools' | 'workflow'} [capability]
 * @property {'current' | 'future'} [capabilityStatus]
 *
 * @typedef {Object} ExplainResponse
 * @property {string} explanation
 * @property {string} [summary]
 * @property {string} [whyItMatters]  // optional explicit personal implication block
 * @property {Array<string|FollowUpAction>} [followUps]  // prefer ≤3 predicted chips
 * @property {MemorySuggestion | null} [memorySuggestion]
 * @property {string} [runtime]
 * @property {ExplainResponseMeta} [meta]
 */

export {};
