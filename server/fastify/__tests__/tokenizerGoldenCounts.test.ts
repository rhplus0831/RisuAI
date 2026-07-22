import { beforeAll, describe, expect, it } from 'vitest'
import {
  ensureTokenizerLoaded,
  PORTABLE_TOKEN_ENCODINGS,
  tokenize,
  type PortableTokenEncoding,
} from '../src/prompt/tokens.js'

const ASCII_FIXTURE = 'Hello world, this is a tokenizer parity test.'
const CJK_FIXTURE = '안녕하세요 세계! 你好，世界！こんにちは世界 🌏'

const GOLDEN_COUNTS: Record<PortableTokenEncoding, { ascii: number; cjk: number }> = {
  claude: { ascii: 10, cjk: 31 },
  llama3: { ascii: 10, cjk: 14 },
  cohere: { ascii: 10, cjk: 20 },
  deepseek: { ascii: 11, cjk: 20 },
  'deepseek-v4': { ascii: 11, cjk: 20 },
  glm4: { ascii: 10, cjk: 17 },
  glm5: { ascii: 10, cjk: 17 },
  gemma: { ascii: 10, cjk: 14 },
  mistral: { ascii: 12, cjk: 31 },
  llama: { ascii: 12, cjk: 33 },
  novelai: { ascii: 12, cjk: 19 },
  novellist: { ascii: 18, cjk: 19 },
}

describe('portable tokenizer golden counts', () => {
  beforeAll(async () => {
    for (const encoding of PORTABLE_TOKEN_ENCODINGS) {
      await ensureTokenizerLoaded(encoding)
    }
  }, 60_000)

  it.each(PORTABLE_TOKEN_ENCODINGS)('matches pinned client-engine counts for %s', (encoding) => {
    expect(tokenize(ASCII_FIXTURE, encoding)).toBe(GOLDEN_COUNTS[encoding].ascii)
    expect(tokenize(CJK_FIXTURE, encoding)).toBe(GOLDEN_COUNTS[encoding].cjk)
  })
})
