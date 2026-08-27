/**
 * Local prefilter (Issue #49).
 *
 * Deliberately light. An earlier design cut 50-70% of conversations by guessing
 * at "information density", justified by token cost — but distillation is
 * input-heavy and output-light, so cost is not the binding constraint here, and
 * the model judges a conversation's value far better than a heuristic can.
 *
 * Filtering that actually matters happens *after* distillation, where candidates
 * are ranked by support so the review screen spends the user's attention well.
 * This pass only drops conversations that cannot produce signal at all.
 */

/**
 * @param {import('../memory-sources/types.js').Conversation[]} conversations
 * @returns {{ kept: import('../memory-sources/types.js').Conversation[], dropped: number }}
 */
export function prefilter(conversations) {
  const kept = conversations.filter(hasUserSignal);
  return { kept, dropped: conversations.length - kept.length };
}

/**
 * A conversation with no user turn says nothing about who the user is, however
 * long the assistant's side runs.
 *
 * @param {import('../memory-sources/types.js').Conversation} conversation
 */
function hasUserSignal(conversation) {
  return conversation.turns.some((turn) => turn.role === "user" && turn.text.trim().length > 0);
}
