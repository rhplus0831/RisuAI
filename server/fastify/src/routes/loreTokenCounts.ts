import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { readChatId } from '../commands/chats.js'
import { EntityNotFoundError, loadPersistedForGenerationAssembly, ValidationError } from '../repository.js'
import { decodeGenerationDatabase } from '../prompt/generationInputDecoder.js'
import {
  buildEffectiveGenerationConfig,
  isChatGenerationSettingsIncompleteAssemblyError,
  isModelProfileGenerationGuardAssemblyError,
} from '../prompt/effectiveGenerationConfig.js'
import { countActiveLoreTokens } from '../prompt/lorebook.js'
import { LoreTokenCountsSchema, LoreTokenCountsErrorSchema as errorSchema } from '@risuai/protocol/lore-token-counts'

export function registerLoreTokenCountRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  dataDir: string,
  authState: AuthState,
): void {
  app.get(
    '/api/v1/chats/:chatId/lore-token-counts',
    {
      exposeHeadRoute: false,
      schema: {
        response: {
          200: LoreTokenCountsSchema,
          400: errorSchema,
          404: errorSchema,
          409: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      reply.header('Cache-Control', 'no-store')
      try {
        const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
        const characterId = readChatId((req.query as { characterId?: unknown }).characterId)
        const persisted = loadPersistedForGenerationAssembly(db, dataDir, { characterId, chatId })
        if (!persisted.database) throw new EntityNotFoundError('Chat token-count target not found')
        const database = decodeGenerationDatabase(persisted.database)
        const selectedCharID = database.characters.findIndex((character) => character.chaId === characterId)
        const currentChar = database.characters[selectedCharID]
        const chatPage = currentChar?.chats.findIndex((chat) => chat.id === chatId) ?? -1
        const currentChat = currentChar?.chats[chatPage]
        if (!currentChat) throw new EntityNotFoundError('Chat token-count target not found')
        const effective = buildEffectiveGenerationConfig({
          database,
          currentChar,
          currentChat,
          selectedCharID,
          chatPage,
        })
        const counts = await countActiveLoreTokens({
          database: effective.database,
          currentChar: effective.currentChar,
          currentChat: effective.currentChat,
          resolveSpeakerName: (id) => persisted.speakerNames?.[id],
          cbsContext: { database: effective.database, modelInfo: effective.resolvedMainProfile.modelInfo },
        })
        return { characterId, chatId, ...counts }
      } catch (error) {
        if (error instanceof EntityNotFoundError) return reply.code(404).send({ error: error.message })
        if (error instanceof ValidationError) return reply.code(400).send({ error: error.message })
        if (
          isChatGenerationSettingsIncompleteAssemblyError(error) ||
          isModelProfileGenerationGuardAssemblyError(error)
        ) {
          return reply.code(error.statusCode).send(error.body)
        }
        req.log.error({ err: error }, 'Lore token calculation failed')
        return reply.code(500).send({ error: 'lore_token_count_failed' })
      }
    },
  )
}
