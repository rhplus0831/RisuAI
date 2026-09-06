import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { get_encoding } from '@dqbd/tiktoken'
import { describe, expect, it } from 'vitest'
import {
  encodeTokens,
  encodingForModel,
  tokenize,
  tokenizeChat,
  tokenizeChats,
  tokenizeMultiModal,
} from '../src/prompt/tokens.js'
import type { PromptMessage } from '../src/prompt/promptMessage.js'

const nodeRequire = createRequire(import.meta.url)

function captureTokenError(operation: () => unknown): Error {
  try {
    operation()
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error('Expected the tokenizer to reject a disallowed special token')
}

describe.each(['cl100k_base', 'o200k_base'] as const)('%s tokenizer parity', (encoding) => {
  const manifest = JSON.parse(
    readFileSync(nodeRequire.resolve(`@dqbd/tiktoken/encoders/${encoding}.json`), 'utf8'),
  ) as { special_tokens: Record<string, number> }
  const specialTokens = Object.keys(manifest.special_tokens)

  it('keeps the ordinary-text guard valid for every installed special token', () => {
    expect(specialTokens.length).toBeGreaterThan(0)
    for (const token of specialTokens) expect(token.startsWith('<|'), token).toBe(true)
  })

  it('preserves exact token ids and counts for ordinary text and incomplete special-token prefixes', () => {
    const oracle = get_encoding(encoding)
    const texts = [
      '',
      'hello world',
      'You are a helpful assistant.\nUser: Continue the story.\nAssistant:',
      'const value = {"count": 42, "enabled": true};\nreturn value.count + 1;',
      ' \t\r\n  leading and trailing whitespace  \n\n',
      '한국어 문장, العربية, Ελληνικά, 中文, 日本語',
      '👩🏽‍💻 🧑‍🤝‍🧑 cafe\u0301 café',
      'unpaired surrogates: \ud800 / \udfff',
      '<p>plain HTML &amp; punctuation</p>',
      '<|',
      'before <|not-a-special-token|> after',
    ]
    try {
      for (const text of texts) {
        const expected = Array.from(oracle.encode(text))
        expect(encodeTokens(text, encoding), text).toEqual(expected)
        expect(tokenize(text, encoding), text).toBe(expected.length)
      }
    } finally {
      oracle.free()
    }
  })

  it('preserves exact errors for every installed disallowed special token', () => {
    const oracle = get_encoding(encoding)
    try {
      for (const specialToken of specialTokens) {
        for (const text of [specialToken, `before ${specialToken} after`]) {
          const expected = captureTokenError(() => oracle.encode(text))
          for (const actual of [
            captureTokenError(() => encodeTokens(text, encoding)),
            captureTokenError(() => tokenize(text, encoding)),
          ]) {
            expect(actual.constructor, text).toBe(expected.constructor)
            expect(actual.name, text).toBe(expected.name)
            expect(actual.message, text).toBe(expected.message)
          }
        }
      }
    } finally {
      oracle.free()
    }
  })
})

describe('encodingForModel', () => {
  it('routes gpt-4o family to o200k_base', () => {
    expect(encodingForModel('gpt-4o')).toBe('o200k_base')
    expect(encodingForModel('gpt-4o-mini')).toBe('o200k_base')
    expect(encodingForModel('gpt-4o-2024-11-20')).toBe('o200k_base')
  })

  it('routes gpt-5 / gpt-4.1 / o1 / o3 / o4 / gpt-oss families to o200k_base', () => {
    expect(encodingForModel('gpt-5')).toBe('o200k_base')
    expect(encodingForModel('gpt-5.2')).toBe('o200k_base')
    expect(encodingForModel('gpt-4.1')).toBe('o200k_base')
    expect(encodingForModel('gpt-4.1-mini')).toBe('o200k_base')
    expect(encodingForModel('o1')).toBe('o200k_base')
    expect(encodingForModel('o1-pro')).toBe('o200k_base')
    expect(encodingForModel('o3-mini')).toBe('o200k_base')
    expect(encodingForModel('o4-mini')).toBe('o200k_base')
    expect(encodingForModel('gpt-oss-20b')).toBe('o200k_base')
  })

  it('falls back to cl100k_base for gpt-4 / Claude / unknown / undefined', () => {
    expect(encodingForModel('gpt-4')).toBe('cl100k_base')
    expect(encodingForModel('gpt-4-turbo')).toBe('cl100k_base')
    expect(encodingForModel('claude-3-5-sonnet')).toBe('cl100k_base')
    expect(encodingForModel('mistral-large')).toBe('cl100k_base')
    expect(encodingForModel(undefined)).toBe('cl100k_base')
    expect(encodingForModel(null)).toBe('cl100k_base')
    expect(encodingForModel('')).toBe('cl100k_base')
  })

  it('is case-insensitive on the model id', () => {
    expect(encodingForModel('GPT-4o')).toBe('o200k_base')
    expect(encodingForModel('GPT-5.4-PRO')).toBe('o200k_base')
  })
})

describe('tokenize', () => {
  it('throws loudly when a portable tokenizer was not warmed', () => {
    expect(() => tokenize('hello world', 'glm5')).toThrow(
      'Call await ensureTokenizerLoaded("glm5") before synchronous token counting',
    )
  })

  it('returns 0 for empty input', () => {
    expect(tokenize('')).toBe(0)
    expect(tokenize('', 'o200k_base')).toBe(0)
  })

  it('counts a known oracle phrase on cl100k_base and o200k_base', () => {
    // Oracle captured from `get_encoding('cl100k_base').encode('hello world')`
    // and `get_encoding('o200k_base').encode('hello world')` — both yield 2.
    expect(tokenize('hello world', 'cl100k_base')).toBe(2)
    expect(tokenize('hello world', 'o200k_base')).toBe(2)
  })

  it('defaults to cl100k_base when no encoding is provided', () => {
    expect(tokenize('hello world')).toBe(tokenize('hello world', 'cl100k_base'))
  })
})

describe('tokenizeChat', () => {
  const baseChat: PromptMessage = {
    role: 'user',
    content: 'hello world',
  }

  it('adds the default per-message overhead of 4', () => {
    // 2 content tokens + 4 overhead.
    expect(tokenizeChat(baseChat)).toBe(6)
  })

  it('honors a custom chatAdditionalTokens override', () => {
    expect(tokenizeChat(baseChat, 'cl100k_base', { chatAdditionalTokens: 0 })).toBe(2)
    expect(tokenizeChat(baseChat, 'cl100k_base', { chatAdditionalTokens: 7 })).toBe(9)
  })

  it("counts `name` plus 1 separator when useName === 'name'", () => {
    const named: PromptMessage = { ...baseChat, name: 'hello world' }
    // Base 6 + name 2 + 1 separator = 9.
    expect(tokenizeChat(named)).toBe(9)
  })

  it("skips the `name` field when useName === 'noName'", () => {
    const named: PromptMessage = { ...baseChat, name: 'hello world' }
    expect(tokenizeChat(named, 'cl100k_base', { useName: 'noName' })).toBe(6)
  })

  it('skips `thoughts` unless countThoughts is set', () => {
    const withThoughts: PromptMessage = {
      ...baseChat,
      thoughts: ['hello world', 'hello world'],
    }
    expect(tokenizeChat(withThoughts)).toBe(6)
    // Base 6 + (2 + 1) per thought.
    expect(tokenizeChat(withThoughts, 'cl100k_base', { countThoughts: true })).toBe(6 + 3 + 3)
  })

  it('charges every multimodal attachment', () => {
    const withImages: PromptMessage = {
      ...baseChat,
      multimodals: [
        { type: 'image', base64: 'a' },
        { type: 'image', base64: 'b' },
      ],
    }

    expect(
      tokenizeChat(withImages, 'cl100k_base', {
        supportsInlayImage: true,
        visionQuality: 'low',
      }),
    ).toBe(6 + 87 + 87)
  })
})

describe('tokenizeMultiModal', () => {
  const image = { type: 'image' as const, base64: 'image' }

  it('uses row overhead when the effective model lacks image input', () => {
    expect(tokenizeMultiModal(image, { chatAdditionalTokens: 5, supportsInlayImage: false })).toBe(5)
  })

  it('uses the fixed low-quality charge', () => {
    expect(
      tokenizeMultiModal(image, {
        chatAdditionalTokens: 5,
        supportsInlayImage: true,
        visionQuality: 'low',
      }),
    ).toBe(87)
  })

  it('ports the non-low square, portrait, landscape, and missing-size tile math', () => {
    const options = {
      chatAdditionalTokens: 5,
      supportsInlayImage: true,
      visionQuality: 'high',
    }

    expect(tokenizeMultiModal({ ...image, width: 1024, height: 1024 }, options)).toBe(98)
    expect(tokenizeMultiModal({ ...image, width: 1000, height: 2000 }, options)).toBe(106)
    expect(tokenizeMultiModal({ ...image, width: 2000, height: 1000 }, options)).toBe(106)
    expect(tokenizeMultiModal(image, options)).toBe(90)
  })
})

describe('tokenizeChats', () => {
  it('sums tokenizeChat across messages', () => {
    const chats: PromptMessage[] = [
      { role: 'system', content: 'hello world' },
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: '' },
    ]
    // 6 + 6 + 4 (empty content still pays overhead).
    expect(tokenizeChats(chats)).toBe(16)
  })

  it('returns 0 for an empty array', () => {
    expect(tokenizeChats([])).toBe(0)
  })
})
