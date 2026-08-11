import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db.js'
import { getDatabaseLineage } from '../src/databaseLineage.js'
import { createCommandEventSink } from '../src/commands/events.js'
import { MessageTranslationJobRegistry } from '../src/messageTranslationJobs.js'
import { writePersistedWithMessages } from '../src/repository.js'
import { retryPendingGenerationCompletionEffects } from '../src/routes/generationChat.js'
import type { ServerMessageTranslationRunner } from '../src/translation/generationCompletionTranslation.js'
import {
  claimGenerationEffect,
  ensureGenerationEffectLedger,
  listGenerationEffects,
  listPendingClientGenerationEffects,
  settleGenerationEffect,
} from '../src/generationEffects.js'

const dataDirs: string[] = []

function openTestDatabase() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-generation-effects-'))
  dataDirs.push(dataDir)
  const db = openDatabase(dataDir)
  return { db, dataDir, lineage: getDatabaseLineage(db) }
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) rmSync(dataDir, { recursive: true, force: true })
})

describe('generation effect ledger', () => {
  it('keys protocol operations by operation and compatibility generations by generation', () => {
    const { db, lineage } = openTestDatabase()
    try {
      const operation = ensureGenerationEffectLedger(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        operationProtocolVersion: 1,
        generationId: 'generation-a',
        characterId: 'character-a',
        chatId: 'chat-a',
        messageId: 'message-a',
      })
      const compatibility = ensureGenerationEffectLedger(db, {
        databaseLineage: lineage,
        operationId: 'legacy-operation',
        operationProtocolVersion: 0,
        generationId: 'generation-b',
        characterId: 'character-a',
        chatId: 'chat-b',
        messageId: 'message-b',
      })

      expect(operation).toMatchObject({ keyType: 'operation', keyId: 'operation-a' })
      expect(compatibility).toMatchObject({ keyType: 'generation', keyId: 'generation-b' })
      expect(listGenerationEffects(db, 'generation-a')).toHaveLength(7)
      expect(listGenerationEffects(db, 'generation-a')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'igp', effectClass: 'durable', status: 'pending' }),
          expect.objectContaining({ kind: 'notification', effectClass: 'ephemeral', status: 'pending' }),
          expect.objectContaining({ kind: 'emotion_image_state', effectClass: 'recomputed', status: 'pending' }),
        ]),
      )
    } finally {
      db.close()
    }
  })

  it('grants one live dispatch for every durable effect and records terminal receipts', () => {
    const { db, lineage } = openTestDatabase()
    try {
      ensureGenerationEffectLedger(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        operationProtocolVersion: 1,
        generationId: 'generation-a',
        characterId: 'character-a',
        chatId: 'chat-a',
        messageId: 'message-a',
      })

      for (const kind of ['igp', 'plugin_output', 'generated_translation'] as const) {
        const delivery = kind === 'generated_translation' ? 'server' : 'live_terminal'
        const claim = claimGenerationEffect(db, {
          databaseLineage: lineage,
          generationId: 'generation-a',
          kind,
          delivery,
          messageId: 'message-a',
        })
        expect(claim).toMatchObject({ status: 'claimed', effect: { status: 'claimed' } })
        if (claim.status !== 'claimed') throw new Error('expected claim')
        expect(
          settleGenerationEffect(db, {
            databaseLineage: lineage,
            generationId: 'generation-a',
            kind,
            claimId: claim.claimId,
            status: 'completed',
          }),
        ).toMatchObject({ status: 'completed', delivery })

        expect(
          claimGenerationEffect(db, {
            databaseLineage: lineage,
            generationId: 'generation-a',
            kind,
            delivery: kind === 'generated_translation' ? 'server' : 'late_recovery',
          }),
        ).toMatchObject({ status: 'not_claimed', reason: 'already_receipted', effect: { status: 'completed' } })
      }
    } finally {
      db.close()
    }
  })

  it('permanently skips ephemeral work on late recovery without granting execution', () => {
    const { db, lineage } = openTestDatabase()
    try {
      ensureGenerationEffectLedger(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        operationProtocolVersion: 1,
        generationId: 'generation-a',
        characterId: 'character-a',
        chatId: 'chat-a',
        messageId: 'message-a',
      })

      for (const kind of ['notification', 'tts', 'completion_sound'] as const) {
        expect(
          claimGenerationEffect(db, {
            databaseLineage: lineage,
            generationId: 'generation-a',
            kind,
            delivery: 'late_recovery',
          }),
        ).toMatchObject({
          status: 'not_claimed',
          reason: 'late_recovery_skipped',
          effect: { status: 'skipped', delivery: 'late_recovery', reason: 'late_recovery' },
        })
      }
      expect(listPendingClientGenerationEffects(db).map((effect) => effect.kind)).not.toEqual(
        expect.arrayContaining(['notification', 'tts', 'completion_sound']),
      )
    } finally {
      db.close()
    }
  })

  it('reserves generated translation for the server owner', () => {
    const { db, lineage } = openTestDatabase()
    try {
      ensureGenerationEffectLedger(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        operationProtocolVersion: 1,
        generationId: 'generation-a',
        characterId: 'character-a',
        chatId: 'chat-a',
        messageId: 'message-a',
      })
      expect(
        claimGenerationEffect(db, {
          databaseLineage: lineage,
          generationId: 'generation-a',
          kind: 'generated_translation',
          delivery: 'late_recovery',
        }),
      ).toMatchObject({ status: 'not_claimed', reason: 'server_owned' })
      expect(
        claimGenerationEffect(db, {
          databaseLineage: lineage,
          generationId: 'generation-a',
          kind: 'generated_translation',
          delivery: 'server',
        }),
      ).toMatchObject({ status: 'claimed' })
    } finally {
      db.close()
    }
  })

  it('converges interrupted and uninterrupted jobs on the same durable receipts', () => {
    const { db, lineage } = openTestDatabase()
    try {
      for (const generationId of ['live-generation', 'recovered-generation']) {
        ensureGenerationEffectLedger(db, {
          databaseLineage: lineage,
          operationId: `${generationId}-operation`,
          operationProtocolVersion: 1,
          generationId,
          characterId: 'character-a',
          chatId: 'chat-a',
          messageId: `${generationId}-message`,
        })
      }

      for (const kind of ['igp', 'plugin_output', 'generated_translation'] as const) {
        for (const generationId of ['live-generation', 'recovered-generation']) {
          const claim = claimGenerationEffect(db, {
            databaseLineage: lineage,
            generationId,
            kind,
            delivery:
              kind === 'generated_translation'
                ? 'server'
                : generationId === 'live-generation'
                  ? 'live_terminal'
                  : 'late_recovery',
          })
          if (claim.status !== 'claimed') throw new Error('expected claim')
          settleGenerationEffect(db, {
            databaseLineage: lineage,
            generationId,
            kind,
            claimId: claim.claimId,
            status: 'completed',
          })
        }
      }

      const durableOutcome = (generationId: string) =>
        listGenerationEffects(db, generationId)
          .filter((effect) => effect.effectClass === 'durable')
          .map((effect) => ({ kind: effect.kind, status: effect.status }))
      expect(durableOutcome('recovered-generation')).toEqual(durableOutcome('live-generation'))
    } finally {
      db.close()
    }
  })

  it('replays a pending server-owned translation once after a late restart sweep', async () => {
    const { db, dataDir, lineage } = openTestDatabase()
    try {
      writePersistedWithMessages(db, dataDir, {
        _version: 1,
        database: {
          translator: 'ko',
          translatorType: 'google',
          characters: [
            {
              chaId: 'character-a',
              name: 'Character',
              chatPage: 0,
              chatFolders: [],
              chats: [
                {
                  id: 'chat-a',
                  name: 'Chat',
                  note: '',
                  localLore: [],
                  autoTranslate: true,
                  message: [{ role: 'char', data: 'Generated reply', chatId: 'message-a' }],
                },
              ],
            },
          ],
          characterOrder: ['character-a'],
        },
        assets: [],
      })
      ensureGenerationEffectLedger(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        operationProtocolVersion: 1,
        generationId: 'generation-a',
        characterId: 'character-a',
        chatId: 'chat-a',
        messageId: 'message-a',
      })
      const runMessageTranslation: ServerMessageTranslationRunner = vi.fn(async (input) => ({
        revision: 2,
        event: {
          type: 'messageUpdated' as const,
          revision: 2,
          resource: 'chatMessages',
          id: input.messageId,
          parentId: 'chat-a',
        },
        jobId: input.jobId,
        chatId: 'chat-a',
        messageId: input.messageId,
        translation: {
          source: 'raw' as const,
          text: '번역됨',
          sourceHash: 'source-hash',
          targetLanguage: 'ko',
          inputLanguage: 'en',
          translatorType: 'google' as const,
          settingsHash: 'settings-hash',
          updatedAt: 1,
        },
      }))
      const args = {
        db,
        dataDir,
        eventSink: createCommandEventSink(),
        messageTranslationJobs: new MessageTranslationJobRegistry(),
        runMessageTranslation,
      }

      await expect(retryPendingGenerationCompletionEffects(args)).resolves.toBe(1)
      await expect(retryPendingGenerationCompletionEffects(args)).resolves.toBe(0)

      expect(runMessageTranslation).toHaveBeenCalledTimes(1)
      expect(listGenerationEffects(db, 'generation-a')).toContainEqual(
        expect.objectContaining({
          kind: 'generated_translation',
          status: 'completed',
          delivery: 'server',
        }),
      )
    } finally {
      db.close()
    }
  })
})
