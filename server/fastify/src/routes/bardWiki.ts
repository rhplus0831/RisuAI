import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  BARDWIKI_PROTOCOL_VERSION,
  DEFAULT_BARDWIKI_GLOBAL_SETTINGS,
  isBardWikiGlobalSettings,
  type BardWikiChatResource,
  type BardWikiDocumentIndex,
  type BardWikiDocumentResource,
  type BardWikiGlobalSettings,
  type BardWikiVersionsResource,
} from '@risuai/protocol/bardwiki'
import type { AuthState } from '../auth.js'
import {
  getBardWikiChatSettings,
  getBardWikiDocument,
  listBardWikiDocumentVersionPage,
  listBardWikiDocuments,
  listBardWikiJobSummaries,
  listBardWikiLinks,
  listBardWikiReceiptSummaries,
  type BardWikiChatSettings,
} from '../bardWikiRepository.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import { loadSettingsFromSqlite } from '../repository.js'

const BARDWIKI_READ_DEFAULT_LIMIT = 50
const BARDWIKI_READ_MAX_LIMIT = 100

export function registerBardWikiReadRoutes(app: FastifyInstance, db: DatabaseSync, authState: AuthState): void {
  app.get<{ Params: { chatId: string } }>('/api/v1/bardwiki/chats/:chatId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const chatId = readId(req.params.chatId)
    if (!chatId) return sendInvalidId(reply, 'chatId')
    if (!chatExists(db, chatId)) return sendNotFound(reply, 'bardwiki_chat_not_found')

    const { revision } = getSchemaState(db)
    const globalSettings = loadGlobalSettings(db)
    const chatSettings = getBardWikiChatSettings(db, chatId)
    const payload: BardWikiChatResource = {
      protocolVersion: BARDWIKI_PROTOCOL_VERSION,
      revision,
      chatId,
      globalSettings,
      chatSettings,
      effectiveSettings: resolveEffectiveSettings(globalSettings, chatSettings),
      documents: listBardWikiDocuments(db, chatId).map(toDocumentIndex),
      receipts: listBardWikiReceiptSummaries(db, chatId),
      jobs: listBardWikiJobSummaries(db, chatId),
    }
    return sendEtagJson(req, reply, payload)
  })

  app.get<{ Params: { chatId: string; documentId: string } }>(
    '/api/v1/bardwiki/chats/:chatId/documents/:documentId',
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const chatId = readId(req.params.chatId)
      const documentId = readId(req.params.documentId)
      if (!chatId) return sendInvalidId(reply, 'chatId')
      if (!documentId) return sendInvalidId(reply, 'documentId')
      const document = getBardWikiDocument(db, chatId, documentId)
      if (!document) return sendNotFound(reply, 'bardwiki_document_not_found')
      const payload: BardWikiDocumentResource = {
        protocolVersion: BARDWIKI_PROTOCOL_VERSION,
        revision: getSchemaState(db).revision,
        chatId,
        document,
        links: listBardWikiLinks(db, documentId, document.version),
      }
      return sendEtagJson(req, reply, payload)
    },
  )

  app.get<{
    Params: { chatId: string; documentId: string }
    Querystring: { limit?: string; beforeVersion?: string }
  }>('/api/v1/bardwiki/chats/:chatId/documents/:documentId/versions', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const chatId = readId(req.params.chatId)
    const documentId = readId(req.params.documentId)
    if (!chatId) return sendInvalidId(reply, 'chatId')
    if (!documentId) return sendInvalidId(reply, 'documentId')
    if (!getBardWikiDocument(db, chatId, documentId, { includeDeleted: true })) {
      return sendNotFound(reply, 'bardwiki_document_not_found')
    }
    const limit = readBoundedInteger(req.query.limit, BARDWIKI_READ_DEFAULT_LIMIT, 1, BARDWIKI_READ_MAX_LIMIT)
    const beforeVersion = readBoundedInteger(req.query.beforeVersion, undefined, 1, Number.MAX_SAFE_INTEGER)
    if (limit === null || beforeVersion === null) {
      reply.code(400)
      return { error: 'invalid_bardwiki_pagination' }
    }
    const page = listBardWikiDocumentVersionPage(db, documentId, {
      limit: limit ?? BARDWIKI_READ_DEFAULT_LIMIT,
      ...(beforeVersion === undefined ? {} : { beforeVersion }),
    })
    const payload: BardWikiVersionsResource = {
      protocolVersion: BARDWIKI_PROTOCOL_VERSION,
      revision: getSchemaState(db).revision,
      chatId,
      documentId,
      versions: page.versions,
      nextBeforeVersion: page.nextBeforeVersion,
    }
    return sendEtagJson(req, reply, payload)
  })

  app.get<{
    Params: { chatId: string }
    Querystring: { limit?: string }
  }>('/api/v1/bardwiki/chats/:chatId/receipts', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const chatId = readId(req.params.chatId)
    if (!chatId) return sendInvalidId(reply, 'chatId')
    if (!chatExists(db, chatId)) return sendNotFound(reply, 'bardwiki_chat_not_found')
    const limit = readBoundedInteger(req.query.limit, BARDWIKI_READ_DEFAULT_LIMIT, 1, BARDWIKI_READ_MAX_LIMIT)
    if (limit === null) {
      reply.code(400)
      return { error: 'invalid_bardwiki_pagination' }
    }
    return sendEtagJson(req, reply, {
      protocolVersion: BARDWIKI_PROTOCOL_VERSION,
      revision: getSchemaState(db).revision,
      chatId,
      receipts: listBardWikiReceiptSummaries(db, chatId, limit),
    })
  })
}

function toDocumentIndex(document: ReturnType<typeof listBardWikiDocuments>[number]): BardWikiDocumentIndex {
  return {
    id: document.id,
    chatId: document.chatId,
    kind: document.kind,
    title: document.title,
    logicalPath: document.logicalPath,
    normalizedPath: document.normalizedPath,
    aliases: document.aliases,
    contextPolicy: document.contextPolicy,
    reviewState: document.reviewState,
    contentHash: document.contentHash,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

function loadGlobalSettings(db: DatabaseSync): BardWikiGlobalSettings {
  const settings = loadSettingsFromSqlite(db)
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS }
  }
  const value = (settings as Record<string, unknown>).bardWiki
  return isBardWikiGlobalSettings(value) ? { ...value } : { ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS }
}

function resolveEffectiveSettings(
  global: BardWikiGlobalSettings,
  chat: BardWikiChatSettings | null,
): BardWikiGlobalSettings {
  if (!chat) return { ...global }
  return {
    enabledByDefault: chat.enabledOverride ?? global.enabledByDefault,
    memoryMode: chat.memoryModeOverride ?? global.memoryMode,
    confirmationPolicy: chat.confirmationPolicyOverride ?? global.confirmationPolicy,
    modelProfileId: chat.modelProfileIdIsSet ? chat.modelProfileIdOverride : global.modelProfileId,
    promptPresetId: chat.promptPresetIdIsSet ? chat.promptPresetIdOverride : global.promptPresetId,
    canonicalUpdates: chat.canonicalUpdatesOverride ?? global.canonicalUpdates,
    totalTokenBudget: chat.totalTokenBudgetOverride ?? global.totalTokenBudget,
    hybridHypaTokenBudget: chat.hybridHypaTokenBudgetOverride ?? global.hybridHypaTokenBudget,
    hybridBardWikiTokenBudget: chat.hybridBardWikiTokenBudgetOverride ?? global.hybridBardWikiTokenBudget,
    maxDocuments: chat.maxDocumentsOverride ?? global.maxDocuments,
    maxLinkHops: chat.maxLinkHopsOverride ?? global.maxLinkHops,
    recentMessageCount: chat.recentMessageCountOverride ?? global.recentMessageCount,
  }
}

function sendEtagJson<T>(req: FastifyRequest, reply: FastifyReply, payload: T): T | undefined {
  const etag = `"${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}"`
  reply.header('etag', etag)
  reply.header('cache-control', 'private, no-cache')
  if (req.headers['if-none-match'] === etag) {
    reply.code(304).send()
    return undefined
  }
  return payload
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null
}

function readBoundedInteger(
  value: unknown,
  defaultValue: number | undefined,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (value === undefined) return defaultValue
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function chatExists(db: DatabaseSync, chatId: string): boolean {
  return db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chatId) !== undefined
}

function sendInvalidId(reply: FastifyReply, field: string): { error: string } {
  reply.code(400)
  return { error: `${field} must be a valid non-empty string` }
}

function sendNotFound(reply: FastifyReply, error: string): { error: string } {
  reply.code(404)
  return { error }
}
