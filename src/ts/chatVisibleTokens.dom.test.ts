import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, character } from './storage/database.svelte'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(
    async (source: string, ..._args: unknown[]) => `<p>${source}</p><details><summary>Note</summary>secret</details>`,
  ),
  cbs: vi.fn((source: string, ..._args: unknown[]) => source),
  tokenize: vi.fn(async (source: string) => source.length),
}))
vi.mock('./parser/parser.svelte', () => ({
  ParseMarkdown: mocks.parse,
  risuChatParser: mocks.cbs,
  trimMarkdown: (html: string) => html,
}))
vi.mock('./tokenizer', () => ({ tokenize: mocks.tokenize }))
vi.mock('./utilState', () => ({ getUserName: () => 'User' }))
vi.mock('./server/resourceState.svelte', () => ({ settingsResourceState: { value: {} } }))
import { getChatVisibleTokens } from './chatVisibleTokens'

const character = { chaId: 'character', name: 'Bot' } as character
beforeEach(() => {
  vi.clearAllMocks()
})

describe('complete static visible token count', () => {
  it('processes every message with its stable identity and counts final readable text', async () => {
    const chat = {
      id: 'chat',
      message: Array.from({ length: 41 }, (_, index) => ({
        role: 'char',
        chatId: `message-${index}`,
        data: `body ${index}`,
      })),
    } as Chat
    const count = await getChatVisibleTokens(character, chat)
    expect(mocks.parse).toHaveBeenCalledTimes(41)
    expect(mocks.parse).toHaveBeenLastCalledWith(
      'body 40',
      expect.anything(),
      'normal',
      40,
      { firstmsg: false, chatRole: 'char' },
      expect.objectContaining({ chatId: 'chat', messageId: 'message-40', layer: 'original' }),
    )
    expect(mocks.tokenize.mock.calls.every(([text]) => !text.includes('secret') && !text.includes('<'))).toBe(true)
    expect(count).toBe(chat.message.reduce((total, row) => total + `${row.data}\nNote`.length, 0))
  })

  it('uses saved translations for automatic display, including bilingual display', async () => {
    const chat = {
      id: 'chat',
      autoTranslate: true,
      message: [{ role: 'char', chatId: 'm', data: 'Original', translation: { source: 'raw', text: 'Translation' } }],
    } as Chat
    await getChatVisibleTokens(character, chat)
    expect(mocks.parse).toHaveBeenLastCalledWith(
      'Translation',
      expect.anything(),
      'normal',
      0,
      expect.anything(),
      expect.objectContaining({ layer: 'translation' }),
    )
    chat.bilingualDisplay = true
    await getChatVisibleTokens(character, chat)
    const last = mocks.parse.mock.calls.at(-1)!
    expect(last[0]).toContain('Original')
    expect(last[0]).toContain('Translation')
    expect(last[5]).toMatchObject({ layer: 'bilingual' })
  })

  it('stops before tokenizing a batch cancelled during parsing', async () => {
    const controller = new AbortController()
    mocks.parse.mockImplementationOnce(async () => {
      controller.abort()
      return 'obsolete'
    })
    const chat = { id: 'chat', message: [{ role: 'char', chatId: 'm', data: 'hello' }] } as Chat
    await expect(getChatVisibleTokens(character, chat, controller.signal)).rejects.toThrow()
    expect(mocks.tokenize).not.toHaveBeenCalled()
  })
})
