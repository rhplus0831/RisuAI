import { describe, expect, it } from 'vitest'
import {
  BARDWIKI_PROTOCOL_VERSION,
  DEFAULT_BARDWIKI_GLOBAL_SETTINGS,
  isBardWikiChatResource,
  isBardWikiDocumentResource,
  isBardWikiGlobalSettings,
  isBardWikiVersionsResource,
} from '@risuai/protocol'

const hash = 'a'.repeat(64)
const document = {
  id: 'document-1',
  chatId: 'chat-1',
  kind: 'location',
  title: 'Old Tavern',
  logicalPath: 'Places/Old Tavern',
  normalizedPath: 'places/old tavern',
  aliases: ['The Inn'],
  contextPolicy: 'relevant',
  reviewState: 'active',
  contentHash: hash,
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
} as const

describe('BardWiki protocol', () => {
  it('locks the default global settings and their supported bounds', () => {
    expect(DEFAULT_BARDWIKI_GLOBAL_SETTINGS).toEqual({
      enabledByDefault: false,
      memoryMode: 'hypa',
      confirmationPolicy: 'manual',
      modelProfileId: null,
      promptPresetId: null,
      canonicalUpdates: false,
      totalTokenBudget: 2048,
      hybridHypaTokenBudget: 1024,
      hybridBardWikiTokenBudget: 1024,
      maxDocuments: 8,
      maxLinkHops: 1,
      recentMessageCount: 12,
    })
    expect(isBardWikiGlobalSettings(DEFAULT_BARDWIKI_GLOBAL_SETTINGS)).toBe(true)
    expect(isBardWikiGlobalSettings({ ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS, maxLinkHops: 3 })).toBe(false)
  })

  it('validates body-free chat indexes and rejects additive wire fields', () => {
    const resource = {
      protocolVersion: BARDWIKI_PROTOCOL_VERSION,
      revision: 4,
      chatId: 'chat-1',
      globalSettings: DEFAULT_BARDWIKI_GLOBAL_SETTINGS,
      chatSettings: null,
      effectiveSettings: DEFAULT_BARDWIKI_GLOBAL_SETTINGS,
      documents: [document],
      receipts: [],
      jobs: [],
    }
    expect(isBardWikiChatResource(resource)).toBe(true)
    expect(isBardWikiChatResource({ ...resource, futureField: true })).toBe(false)
    expect(isBardWikiChatResource({ ...resource, documents: [{ ...document, markdown: 'not allowed' }] })).toBe(false)
  })

  it('validates lazy document bodies and paginated immutable versions', () => {
    expect(
      isBardWikiDocumentResource({
        protocolVersion: BARDWIKI_PROTOCOL_VERSION,
        revision: 4,
        chatId: 'chat-1',
        document: { ...document, markdown: '# Old Tavern', deletedAt: null },
        links: [
          {
            sourceDocumentId: 'document-1',
            sourceVersion: 1,
            ordinal: 0,
            rawTarget: 'People/Ada',
            normalizedTarget: 'people/ada',
            resolvedDocumentId: null,
          },
        ],
      }),
    ).toBe(true)
    expect(
      isBardWikiVersionsResource({
        protocolVersion: BARDWIKI_PROTOCOL_VERSION,
        revision: 4,
        chatId: 'chat-1',
        documentId: 'document-1',
        versions: [
          {
            documentId: document.id,
            version: 1,
            kind: document.kind,
            title: document.title,
            logicalPath: document.logicalPath,
            normalizedPath: document.normalizedPath,
            aliases: document.aliases,
            contextPolicy: document.contextPolicy,
            reviewState: document.reviewState,
            markdown: '# Old Tavern',
            contentHash: document.contentHash,
            deleted: false,
            actor: 'user',
            reason: 'create',
            receiptId: null,
            jobId: null,
            commandRevision: 4,
            createdAt: document.createdAt,
          },
        ],
        nextBeforeVersion: null,
      }),
    ).toBe(true)
  })
})
