/**
 * Shared large-corpus fixture (test-only).
 *
 * Shared seeded corpus used by server and client cost assertions:
 *
 * - server tests import it from `server/fastify/__tests__/` and seed it through
 *   `POST /api/v1/import/risusave` (or `writePersistedWithMessages`), then put
 *   the load-count harness (`helpers/loadCostHarness.ts`) around a route;
 * - client tests assign `fixture.database` to `DBState.db` (cast like the
 *   existing command-test seeds) and put `withCloneInstrumentation` around a
 *   snapshot call.
 *
 * The corpus is big enough that a whole-corpus load/clone is unmistakable next
 * to a scoped one (many characters, one large hydrated chat, every collection
 * family populated, HypaV3 summaries with embedding-sized vector bulk), but
 * small enough to keep both suites fast. Sizes are configurable for the manual
 * `RISU_PROTOCOL_METRICS=1` measurement runs.
 *
 * Deliberately self-contained (zero imports): the file compiles under the
 * server's strict tsconfig and the client's test transform alike, and importing
 * it can never drag app runtime modules across suite boundaries. Like
 * `cloneCostHarness.ts` it lives in a `src` test directory the client-lib
 * build excludes.
 */

export interface LargeCorpusOptions {
  /** Number of characters (default 12). */
  characterCount?: number
  /** Chats per character (default 3). */
  chatsPerCharacter?: number
  /** Messages in the single hot chat (default 120). */
  hotChatMessageCount?: number
  /** Messages in every other chat (default 8). */
  coldChatMessageCount?: number
  /** Approximate byte length of each message body (default 220). */
  messageBodySize?: number
  /** Rows per collection family — presets/modules/lorebooks/… (default 6). */
  collectionSize?: number
  /** Lorebook entries per character `globalLore` (default 5). */
  lorebookEntriesPerCharacter?: number
  /** HypaV3 summaries on the hot chat (default 8). */
  hotChatSummaryCount?: number
  /** Dimension of the embedding-style vectors carried by the fixture (default 64). */
  embeddingDim?: number
  /**
   * Approximate byte length of each character's `desc` card text (default
   * 2048). Real corpora carry multi-hundred-KB cards; scale this up so a
   * whole-corpus `loadPersisted` re-parse costs measurable wall-clock, not
   * just a load count.
   */
  characterBulkBytes?: number
}

export interface LargeCorpusMessage {
  role: string
  data: string
  chatId: string
  time: number
}

export interface LargeCorpusGenerationSettings {
  configured: true
  personaId: string
  modelPresetId: string
  promptPresetId: string
  jailbreakToggle: boolean
  sidebarToggles: Record<string, string>
}

export interface LargeCorpusChat {
  id: string
  name: string
  note: string
  folderId: null
  message: LargeCorpusMessage[]
  localLore: unknown[]
  scriptstate: Record<string, string>
  fmIndex: number
  generationSettings: LargeCorpusGenerationSettings
  hypaV3Data?: {
    summaries: { text: string; chatMemos: string[]; isImportant: boolean }[]
    lastSelectedSummaries: number[]
  }
}

export interface LargeCorpusCharacter {
  type: 'character'
  chaId: string
  name: string
  desc: string
  chatPage: number
  chats: LargeCorpusChat[]
  chatFolders: unknown[]
  globalLore: unknown[]
  lastInteraction: number
}

export interface LargeCorpusFixture {
  /** The full `Database`-shaped object both suites seed from. */
  database: Record<string, unknown>
  /** All characters, typed for client-side `DBState.db` assignment. */
  characters: LargeCorpusCharacter[]
  /** The one large hydrated chat. Has messages AND `hypaV3Data`. */
  hot: { characterId: string; chatId: string; messageCount: number }
  /**
   * A chat with message rows but NO `hypaV3Data` — after import its
   * `chat_hypa_v3` row is absent, the exact shape whose hydration falls into
   * the whole-corpus `loadPersisted` fallback.
   */
  noHypa: { characterId: string; chatId: string; messageCount: number }
  /** Every chat id in the corpus, hot chat first. */
  allChatIds: string[]
  /** Embedding-style vectors for memory-table seeding (`embeddingDim` floats each). */
  embeddingVectors: number[][]
}

function lorebookEntry(scope: string, index: number): Record<string, unknown> {
  return {
    key: `keyword-${scope}-${index}`,
    secondkey: '',
    insertorder: 100 + index,
    comment: `entry ${scope}-${index}`,
    content: `Lore content for ${scope} entry ${index}. `.repeat(4),
    mode: 'normal',
    alwaysActive: index % 3 === 0,
    selective: false,
  }
}

function deterministicVector(seed: number, dim: number): number[] {
  const vector: number[] = []
  // Cheap deterministic pseudo-floats; no Math.random so runs are reproducible.
  for (let i = 0; i < dim; i += 1) {
    vector.push(Math.sin(seed * 31 + i * 7) * 0.5)
  }
  return vector
}

/**
 * Build the seeded large corpus. Deterministic: same options, same corpus.
 */
export function buildLargeCorpusFixture(options: LargeCorpusOptions = {}): LargeCorpusFixture {
  const characterCount = options.characterCount ?? 12
  const chatsPerCharacter = options.chatsPerCharacter ?? 3
  const hotChatMessageCount = options.hotChatMessageCount ?? 120
  const coldChatMessageCount = options.coldChatMessageCount ?? 8
  const messageBodySize = options.messageBodySize ?? 220
  const collectionSize = options.collectionSize ?? 6
  const lorebookEntriesPerCharacter = options.lorebookEntriesPerCharacter ?? 5
  const hotChatSummaryCount = options.hotChatSummaryCount ?? 8
  const embeddingDim = options.embeddingDim ?? 64
  const characterBulkBytes = options.characterBulkBytes ?? 2048

  const personaId = 'corpus-persona-0'
  const modelPresetId = 'corpus-model-preset-0'
  const promptPresetId = 'corpus-prompt-preset-0'
  const body = 'x'.repeat(messageBodySize)
  const cardBody = 'A character card paragraph. '.repeat(Math.ceil(characterBulkBytes / 28))
  const characters: LargeCorpusCharacter[] = []
  const allChatIds: string[] = []

  for (let c = 0; c < characterCount; c += 1) {
    const chaId = `corpus-char-${c}`
    const chats: LargeCorpusChat[] = []
    for (let t = 0; t < chatsPerCharacter; t += 1) {
      const chatId = `corpus-chat-${c}-${t}`
      const isHot = c === 0 && t === 0
      const messageCount = isHot ? hotChatMessageCount : coldChatMessageCount
      const messages: LargeCorpusMessage[] = []
      for (let m = 0; m < messageCount; m += 1) {
        messages.push({
          role: m % 2 === 0 ? 'user' : 'char',
          data: `${body}-${c}-${t}-${m}`,
          chatId: `corpus-msg-${c}-${t}-${m}`,
          time: 1700000000000 + m,
        })
      }
      const chat: LargeCorpusChat = {
        id: chatId,
        name: `Chat ${c}-${t}`,
        note: `note-${c}-${t}`,
        folderId: null,
        message: messages,
        localLore: [lorebookEntry(`local-${c}-${t}`, 0)],
        scriptstate: { $corpusScore: String(c * 10 + t) },
        fmIndex: -1,
        generationSettings: {
          configured: true,
          personaId,
          modelPresetId,
          promptPresetId,
          jailbreakToggle: false,
          sidebarToggles: {},
        },
      }
      if (isHot) {
        chat.hypaV3Data = {
          summaries: Array.from({ length: hotChatSummaryCount }, (_unused, s) => ({
            text: `Summary ${s} of the hot chat. `.repeat(6),
            chatMemos: [`corpus-msg-${c}-${t}-${s * 2}`, `corpus-msg-${c}-${t}-${s * 2 + 1}`],
            isImportant: s === 0,
          })),
          lastSelectedSummaries: [],
        }
      }
      chats.push(chat)
      allChatIds.push(chatId)
    }
    characters.push({
      type: 'character',
      chaId,
      name: `Corpus Character ${c}`,
      desc: `${cardBody} [card ${c}]`,
      chatPage: 0,
      chats,
      chatFolders: [],
      globalLore: Array.from({ length: lorebookEntriesPerCharacter }, (_unused, i) => lorebookEntry(`char-${c}`, i)),
      lastInteraction: c,
    })
  }

  const collectionIndices = Array.from({ length: collectionSize }, (_unused, i) => i)
  const database: Record<string, unknown> = {
    // Settings scalars.
    currentChar: 0,
    characterOrder: characters.map((c) => c.chaId),
    language: 'en',
    username: 'corpus-user',
    userIcon: '',
    personaPrompt: 'corpus persona prompt',
    userNote: '',
    theme: 'dark',
    loreBookPage: 0,
    botPresets: [],
    modelPresetsId: 0,
    promptPresetsId: 0,
    selectedPersona: 0,
    enabledModules: ['corpus-module-0'],
    temperature: 0.7,
    // Collection families (one row per index).
    modelPresets: collectionIndices.map((i) => ({
      id: `corpus-model-preset-${i}`,
      name: `Model Preset ${i}`,
      temperature: 0.1 * i,
      maxContext: 100_000,
      maxResponse: 50,
    })),
    promptPresets: collectionIndices.map((i) => ({
      id: `corpus-prompt-preset-${i}`,
      name: `Prompt Preset ${i}`,
      promptTemplate: [{ type: 'plain', text: `preset prompt ${i}`, role: 'system' }],
    })),
    modules: collectionIndices.map((i) => ({
      id: `corpus-module-${i}`,
      name: `Module ${i}`,
      description: `module ${i}`,
      regex: [],
      trigger: [],
      lorebook: [lorebookEntry(`module-${i}`, 0), lorebookEntry(`module-${i}`, 1)],
    })),
    plugins: [],
    personas: collectionIndices.map((i) => ({
      id: `corpus-persona-${i}`,
      name: `Persona ${i}`,
      personaPrompt: `persona prompt ${i}`,
      note: `persona note ${i}`,
      icon: '',
    })),
    loadouts: collectionIndices.map((i) => ({
      id: `corpus-loadout-${i}`,
      name: `Loadout ${i}`,
      lastUsed: i,
    })),
    loreBook: collectionIndices.map((i) => ({
      id: `corpus-lore-${i}`,
      name: `Global Lore ${i}`,
      data: [lorebookEntry(`global-${i}`, 0), lorebookEntry(`global-${i}`, 1)],
    })),
    translatorPresets: collectionIndices.map((i) => ({
      id: `corpus-tp-${i}`,
      name: `Translator ${i}`,
      prompt: `translate prompt ${i}`,
      maxResponse: 500 + i,
    })),
    hypaV3Presets: collectionIndices.map((i) => ({ name: `hypa-preset-${i}` })),
    promptTemplate: [{ type: 'plain', text: 'corpus active template', role: 'system' }],
    pluginCustomStorage: { 'corpus-plugin': { counter: 1 } },
    characters,
  }

  return {
    database,
    characters,
    hot: {
      characterId: characters[0].chaId,
      chatId: characters[0].chats[0].id,
      messageCount: hotChatMessageCount,
    },
    noHypa: {
      characterId: characters[0].chaId,
      chatId: characters[0].chats[1]?.id ?? characters[1]?.chats[0]?.id ?? '',
      messageCount: coldChatMessageCount,
    },
    allChatIds,
    embeddingVectors: Array.from({ length: hotChatSummaryCount }, (_unused, s) =>
      deterministicVector(s + 1, embeddingDim),
    ),
  }
}
