import type { OpenAIChat } from '../../index.svelte'

/**
 * Fake replacement for hypaMemoryV3. Returns the input chats plus one
 * canned summary entry prepended at the front, marked with
 * `memo: 'hypaMemory'` so sendChat's chat-assembly recognises it as a
 * memory card. The returned `memory` field is a minimal
 * SerializableHypaV3Data shape so currentChat.hypaV3Data can be reassigned.
 *
 * Used via vi.mock('../memory/hypav3') with vi.importActual to preserve the
 * other exports (createHypaV3Preset, type re-exports) that database.svelte.ts
 * pulls in during setDatabase().
 */
export async function hypaMemoryV3(
  chats: OpenAIChat[],
  _currentTokens: number,
  _maxContextTokens: number,
  _currentChat: unknown,
  _nowChatroom: unknown,
  _tokenizer: unknown,
) {
  const summary: OpenAIChat = {
    role: 'system',
    content: 'Summary: in a previous turn the user discussed gardening tips.',
    memo: 'hypaMemory',
  }
  return {
    chats: [summary, ...chats],
    currentTokens: 50,
    memory: {
      summaries: [
        {
          text: 'Summary: in a previous turn the user discussed gardening tips.',
          chatMemos: [],
          isImportant: false,
        },
      ],
    },
    error: undefined,
  }
}
