import { describe, expect, it } from 'vitest'
import { buildLargeCorpusFixture } from './largeCorpusFixture'

// The shared large-corpus fixture is importable by the client suite and shaped
// so a whole-corpus clone/load is unmistakable next to a scoped one.
// (The server suite imports the same module in serverLoadCostHarness.test.ts.)
// NOTE: this is a fixture sanity test, not a clone-cost gate — it must not
// import the clone-cost harness, so the gate-completeness scan ignores it.

describe('large-corpus fixture', () => {
  it('builds a deterministic corpus with the documented shape', () => {
    const a = buildLargeCorpusFixture()
    const b = buildLargeCorpusFixture()
    expect(JSON.stringify(a.database)).toBe(JSON.stringify(b.database))

    expect(a.characters).toHaveLength(12)
    expect(a.database.characters).toBe(a.characters)
    expect(a.database.characterOrder).toEqual(a.characters.map((c) => c.chaId))
    expect(a.allChatIds).toHaveLength(12 * 3)
    expect(new Set(a.allChatIds).size).toBe(a.allChatIds.length)

    // Every collection family is populated (the server stores each in its own
    // table; an unscoped read of any of them is observable).
    for (const family of [
      'modelPresets',
      'promptPresets',
      'modules',
      'personas',
      'loadouts',
      'loreBook',
      'translatorPresets',
      'hypaV3Presets',
    ] as const) {
      expect(a.database[family], family).toHaveLength(6)
    }
    expect(a.database.botPresets).toEqual([])
    expect(a.database.promptTemplate).toHaveLength(1)
  })

  it('separates the hot chat (messages + hypaV3Data) from the no-hypa chat', () => {
    const fixture = buildLargeCorpusFixture()
    const hotChar = fixture.characters.find((c) => c.chaId === fixture.hot.characterId)
    const hotChat = hotChar?.chats.find((c) => c.id === fixture.hot.chatId)
    expect(hotChat?.message).toHaveLength(fixture.hot.messageCount)
    expect(hotChat?.hypaV3Data?.summaries.length).toBeGreaterThan(0)

    const noHypaChar = fixture.characters.find((c) => c.chaId === fixture.noHypa.characterId)
    const noHypaChat = noHypaChar?.chats.find((c) => c.id === fixture.noHypa.chatId)
    expect(fixture.noHypa.chatId).not.toBe(fixture.hot.chatId)
    expect(noHypaChat?.message).toHaveLength(fixture.noHypa.messageCount)
    expect(noHypaChat?.hypaV3Data).toBeUndefined()

    // The hot chat is the only one carrying hypaV3Data, so after a server
    // import exactly one chat_hypa_v3 row exists.
    const withHypa = fixture.characters.flatMap((c) => c.chats).filter((chat) => chat.hypaV3Data !== undefined)
    expect(withHypa.map((chat) => chat.id)).toEqual([fixture.hot.chatId])
  })

  it('is large enough that a whole-corpus clone dwarfs a single-row clone', () => {
    const fixture = buildLargeCorpusFixture()
    const corpusSize = JSON.stringify(fixture.database).length
    const hotChat = fixture.characters[0].chats[0]
    const singleChatSize = JSON.stringify(hotChat).length
    const singleRowSize = JSON.stringify(fixture.characters[1]).length
    // A factor ≥4 keeps a whole-corpus capture distinguishable by size alone.
    expect(corpusSize).toBeGreaterThan(singleChatSize * 4)
    expect(corpusSize).toBeGreaterThan(singleRowSize * 4)
    // And the corpus round-trips through JSON (the wire/persistence format).
    expect(JSON.parse(JSON.stringify(fixture.database))).toEqual(fixture.database)
  })

  it('exposes deterministic embedding vectors for memory-table seeding', () => {
    const fixture = buildLargeCorpusFixture({ embeddingDim: 16, hotChatSummaryCount: 3 })
    expect(fixture.embeddingVectors).toHaveLength(3)
    for (const vector of fixture.embeddingVectors) {
      expect(vector).toHaveLength(16)
      expect(vector.every((v) => Number.isFinite(v) && Math.abs(v) <= 0.5)).toBe(true)
    }
    expect(buildLargeCorpusFixture({ embeddingDim: 16, hotChatSummaryCount: 3 }).embeddingVectors).toEqual(
      fixture.embeddingVectors,
    )
  })

  it('honors size options so the metrics runs can scale the corpus', () => {
    const small = buildLargeCorpusFixture({
      characterCount: 2,
      chatsPerCharacter: 1,
      hotChatMessageCount: 4,
      coldChatMessageCount: 2,
      collectionSize: 1,
    })
    expect(small.characters).toHaveLength(2)
    expect(small.allChatIds).toHaveLength(2)
    // With one chat per character the no-hypa handle moves to the next
    // character's chat, never aliasing the hot chat.
    expect(small.noHypa.chatId).toBe(small.characters[1].chats[0].id)
    expect(small.characters[0].chats[0].message).toHaveLength(4)
  })
})
