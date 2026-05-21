import type { OpenAIChat } from '../index.svelte'

/**
 * Convert user / assistant messages into system entries with the role
 * prefix folded into the content. Used by template `chat` cards when
 * `promptSettings.sendChatAsSystem` is enabled (and the card itself
 * does not opt out via `chatAsOriginalOnSystem`).
 */
export function systemizeChat(chat: OpenAIChat[]): OpenAIChat[] {
  for (let i = 0; i < chat.length; i++) {
    if (chat[i].role === 'user' || chat[i].role === 'assistant') {
      const attr = chat[i].attr ?? []
      if (chat[i].name?.startsWith('example_')) {
        chat[i].content = chat[i].name + ': ' + chat[i].content
      } else if (!attr.includes('nameAdded')) {
        chat[i].content = chat[i].role + ': ' + chat[i].content
      }
      chat[i].role = 'system'
      delete chat[i].memo
      delete chat[i].name
    }
  }
  return chat
}
