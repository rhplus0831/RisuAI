import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleAssets: () => [] }
})

vi.mock('../files/inlays', () => ({
  getInlayAsset: async (id: string) => {
    if (id === 'img-1') {
      return {
        type: 'image' as const,
        data: 'data:image/png;base64,IMG1',
        ext: 'png',
        name: 'img-1.png',
        width: 1,
        height: 1,
      }
    }
    if (id === 'video-1') {
      return {
        type: 'video' as const,
        data: 'data:video/mp4;base64,VID1',
      }
    }
    if (id === 'audio-1') {
      return {
        type: 'audio' as const,
        data: 'data:audio/mp3;base64,AUD1',
      }
    }
    if (id === 'sig-1') {
      return {
        type: 'signature' as const,
        data: 'sig-data',
      }
    }
    return null
  },
  getInlayAssetBlob: async () => null,
  supportsInlayImage: () => true,
}))

vi.mock('../transformers', () => ({
  runImageEmbedding: async () => [{ generated_text: 'caption-text' }],
}))

import { setDatabase, type Database, type Message, type character } from '../../storage/database.svelte'
import { resolveModelProfile } from '../../model/modelProfileResolver'
import {
  formatHistoryMessage as formatHistoryMessageWithModel,
  type FormatHistoryMessageArgs,
} from '../promptAssembly/formatHistoryMessage'

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'cha-1',
    desc: '',
    personality: '',
    scenario: '',
    additionalText: '',
    systemPrompt: '',
    replaceGlobalNote: '',
    chatPage: 0,
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    firstMessage: '',
    notes: '',
    utilityBot: false,
    customscript: [],
    triggerscript: [],
    additionalAssets: [],
    chats: [],
    ...overrides,
  } as unknown as character
}

function makeMsg(overrides: Partial<Message>): Message {
  return {
    role: 'user',
    data: '',
    chatId: 'msg-fixed',
    time: 0,
    ...overrides,
  } as Message
}

let seededDatabase: Database

function seedDb(extra: Partial<Database> = {}) {
  seededDatabase = {
    aiModel: 'xcustom:::no-vision',
    subModel: 'xcustom:::no-vision',
    customModels: [
      {
        id: 'xcustom:::no-vision',
        name: 'no-vision',
        internalId: 'no-vision',
        format: 0,
        flags: [],
        tokenizer: 0,
      },
    ],
    characters: [makeChar()],
    ...extra,
  } as unknown as Database
  setDatabase(seededDatabase)
}

const noCache = (_id: string) => makeChar({ name: 'Cached' })

function formatHistoryMessage(args: Omit<FormatHistoryMessageArgs, 'modelId' | 'database'>) {
  return formatHistoryMessageWithModel({
    ...args,
    database: seededDatabase,
    modelId: resolveModelProfile({ database: seededDatabase, role: 'chatMain' }).modelId,
  })
}

describe('formatHistoryMessage - basic conversion', () => {
  beforeEach(() => {
    seedDb()
  })

  it('converts a user message to role: user with the content', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'user', data: 'Hello' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.role).toBe('user')
    expect(result.content).toBe('Hello')
    expect(result.memo).toBe('msg-fixed')
    expect(result.multimodals).toBeUndefined()
    expect(result.thoughts).toEqual([])
  })

  it('converts a char message to role: assistant', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'char', data: 'Hi there' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hi there')
  })

  it('backfills msg.chatId when missing', async () => {
    const msg = { role: 'user', data: 'x', time: 0 } as Message
    const result = await formatHistoryMessage({
      msg,
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(typeof msg.chatId).toBe('string')
    expect(msg.chatId!.length).toBeGreaterThan(0)
    expect(result.memo).toBe(msg.chatId)
  })
})

describe('formatHistoryMessage - inlay handling', () => {
  beforeEach(() => {
    seedDb()
  })

  it('appends the runImageEmbedding caption for image inlays under a no-vision model', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'user', data: 'see: {{inlay::img-1}}' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.content).toContain('[caption-text]')
    expect(result.content).not.toContain('{{inlay::img-1}}')
    expect(result.multimodals).toBeUndefined()
  })

  it('uses the request-scoped resolved model for image capability checks', async () => {
    const result = await formatHistoryMessageWithModel({
      database: seededDatabase,
      msg: makeMsg({ role: 'user', data: 'see: {{inlay::img-1}}' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      modelId: 'gpt4o',
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })

    expect(result.content).not.toContain('[caption-text]')
    expect(result.multimodals).toEqual([
      expect.objectContaining({ type: 'image', base64: 'data:image/png;base64,IMG1' }),
    ])
  })

  it('records video inlays once and skips subsequent ones (first-wins)', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({
        role: 'user',
        data: '{{inlay::video-1}} and another {{inlay::video-1}}',
      }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.multimodals).toHaveLength(1)
    expect(result.multimodals![0].type).toBe('video')
  })

  it('records signature inlays unconditionally', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({
        role: 'user',
        data: '{{inlay::sig-1}} and {{inlay::sig-1}}',
      }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.multimodals).toHaveLength(2)
    expect(result.multimodals!.every((m) => m.type === 'signature')).toBe(true)
  })

  it('strips {{inlay::X}} from char messages without recording the tag', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'char', data: 'reply with {{inlay::img-1}} appended' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.content).toContain('reply with')
    expect(result.content).not.toContain('{{inlay::img-1}}')
    // char branch never pushes the bare {{inlay::...}} into the inlays array,
    // so no caption is appended either.
    expect(result.content).not.toContain('[caption-text]')
  })

  it('records {{inlayeddata::X}} on char messages (the only inlay variant kept on char)', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'char', data: 'reply {{inlayeddata::img-1}}' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.content).toContain('[caption-text]')
  })
})

describe('formatHistoryMessage - thought extraction', () => {
  beforeEach(() => {
    seedDb()
  })

  it('strips <Thoughts>...</Thoughts> and accumulates the contents', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({
        role: 'char',
        data: 'visible <Thoughts>secret reasoning</Thoughts> tail',
      }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.content).toBe('visible  tail')
    expect(result.thoughts).toEqual(['secret reasoning'])
  })

  it('drops thoughts that fall outside the maxThoughtTagDepth window', async () => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: 5,
      },
    })
    // Condition keeps thoughts when `maxDepth - totalCount <= index`. With
    // maxDepth=5, totalCount=2, the threshold is `5 - 2 = 3`. At index=0
    // (< 3), thoughts are dropped; only the last `maxDepth - threshold`
    // messages keep their thoughts.
    const result = await formatHistoryMessage({
      msg: makeMsg({
        role: 'char',
        data: '<Thoughts>dropped</Thoughts> visible',
      }),
      index: 0,
      totalCount: 2,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.thoughts).toEqual([])
    expect(result.content).toBe(' visible')
  })

  it('keeps thoughts when maxThoughtTagDepth is -1 (no clamp)', async () => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
    })
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'char', data: '<Thoughts>kept</Thoughts>' }),
      index: 0,
      totalCount: 5,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.thoughts).toEqual(['kept'])
  })
})

describe('formatHistoryMessage - sendName wrapper', () => {
  beforeEach(() => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: true,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
    })
  })

  it("wraps the content in <Char's Message> tags when usingPromptTemplate + sendName both hold", async () => {
    const cache = (_id: string) => makeChar({ name: 'NamedChar' })
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'char', data: 'hello', saying: 'cha-1' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: true,
      findCharacterbyIdwithCache: cache,
    })
    expect(result.content).toContain("<NamedChar's Message>")
    expect(result.content).toContain('hello')
    expect(result.content).toContain("</NamedChar's Message>")
  })

  it('skips the wrapper when usingPromptTemplate is false', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'char', data: 'hello', saying: 'cha-1' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.content).toBe('hello')
  })
})

describe('formatHistoryMessage - asset_prompt strip', () => {
  beforeEach(() => {
    seedDb()
  })

  it('strips {{asset_prompt::nonexistent}} when no asset matches and the name is not "icon"', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'user', data: 'before {{asset_prompt::missing}} after' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result.content).toBe('before  after')
    expect(result.multimodals).toBeUndefined()
  })
})

describe('formatHistoryMessage - multimodal cleanup', () => {
  beforeEach(() => {
    seedDb()
  })

  it('deletes the multimodals property when the array is empty', async () => {
    const result = await formatHistoryMessage({
      msg: makeMsg({ role: 'user', data: 'plain text, no inlays' }),
      index: 0,
      totalCount: 1,
      currentChar: makeChar(),
      usingPromptTemplate: false,
      findCharacterbyIdwithCache: noCache,
    })
    expect(result).not.toHaveProperty('multimodals')
  })
})
