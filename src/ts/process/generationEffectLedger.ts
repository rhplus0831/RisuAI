import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import type { Message } from '../storage/database.svelte'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from '../server/activeWriterSession'
import { SERVER_DATABASE_LINEAGE_HEADER } from '../server/commands'
import type { PendingGenerationEffect } from '../server/bootstrap'
import type { ServerGenerationEffectLedgerRef } from './request/serverChatEvents'

export type GenerationEffectKind =
  | 'igp'
  | 'plugin_output'
  | 'notification'
  | 'tts'
  | 'completion_sound'
  | 'emotion_image_state'

export type GenerationEffectDelivery = 'live_terminal' | 'late_recovery'

export type GenerationEffectExecution<T> =
  | { status: 'completed'; value: T }
  | { status: 'skipped'; reason: string; value?: T }

export interface RunGenerationEffectResult<T> {
  executed: boolean
  value?: T
  status: 'completed' | 'skipped' | 'failed' | 'already_receipted' | 'unavailable'
}

interface ClaimedEffectResponse {
  status: 'claimed'
  claimId: string
}

interface NotClaimedEffectResponse {
  status: 'not_claimed'
  reason: string
}

const inFlightEffects = new Map<string, Promise<RunGenerationEffectResult<unknown>>>()

export function completedGenerationEffect<T>(value: T): GenerationEffectExecution<T> {
  return { status: 'completed', value }
}

export function skippedGenerationEffect<T = never>(reason: string, value?: T): GenerationEffectExecution<T> {
  return { status: 'skipped', reason, ...(value === undefined ? {} : { value }) }
}

export function generationEffectRefFromPending(effect: PendingGenerationEffect): ServerGenerationEffectLedgerRef {
  return {
    version: 1,
    databaseLineage: effect.databaseLineage,
    keyType: effect.keyType,
    keyId: effect.keyId,
    generationId: effect.generationId,
    characterId: effect.characterId,
    chatId: effect.chatId,
    messageId: effect.messageId,
  }
}

export function generationEffectRefFromMessage(message: Message): ServerGenerationEffectLedgerRef | undefined {
  const info = message.generationInfo
  const databaseLineage = info?.databaseLineage?.trim()
  const generationId = info?.generationId?.trim()
  const keyType = info?.effectLedgerKeyType
  const keyId = info?.effectLedgerKeyId?.trim()
  const messageId = message.chatId?.trim()
  const characterId = info?.effectLedgerCharacterId?.trim()
  const chatId = info?.effectLedgerChatId?.trim()
  if (
    !databaseLineage ||
    !generationId ||
    !characterId ||
    !chatId ||
    !messageId ||
    (keyType !== 'operation' && keyType !== 'generation') ||
    !keyId
  ) {
    return undefined
  }
  return { version: 1, databaseLineage, keyType, keyId, generationId, characterId, chatId, messageId }
}

/**
 * Obtain the server's one-shot dispatch authority before running an effect,
 * then persist its terminal receipt. With no additive ledger reference (older
 * server), only a live terminal retains the historical behavior.
 */
export function runLedgeredGenerationEffect<T>(
  ref: ServerGenerationEffectLedgerRef | undefined,
  kind: GenerationEffectKind,
  delivery: GenerationEffectDelivery,
  effect: () => Promise<GenerationEffectExecution<T>> | GenerationEffectExecution<T>,
): Promise<RunGenerationEffectResult<T>> {
  if (!ref) {
    if (delivery === 'late_recovery') return Promise.resolve({ executed: false, status: 'unavailable' })
    return Promise.resolve(effect()).then((result) => ({
      executed: true,
      value: result.value,
      status: result.status,
    }))
  }

  const key = `${ref.databaseLineage}:${ref.generationId}:${kind}`
  const existing = inFlightEffects.get(key)
  if (existing) return existing as Promise<RunGenerationEffectResult<T>>

  const running = runClaimedGenerationEffect(ref, kind, delivery, effect)
  inFlightEffects.set(key, running as Promise<RunGenerationEffectResult<unknown>>)
  void running.finally(() => {
    if (inFlightEffects.get(key) === running) inFlightEffects.delete(key)
  })
  return running
}

async function runClaimedGenerationEffect<T>(
  ref: ServerGenerationEffectLedgerRef,
  kind: GenerationEffectKind,
  delivery: GenerationEffectDelivery,
  effect: () => Promise<GenerationEffectExecution<T>> | GenerationEffectExecution<T>,
): Promise<RunGenerationEffectResult<T>> {
  const claim = await claimEffect(ref, kind, delivery)
  if (!claim) return { executed: false, status: 'unavailable' }
  if (claim.status !== 'claimed' || typeof claim.claimId !== 'string') {
    return {
      executed: false,
      status:
        claim.status === 'not_claimed' &&
        (claim.reason === 'already_receipted' || claim.reason === 'late_recovery_skipped')
          ? 'already_receipted'
          : 'unavailable',
    }
  }

  try {
    const result = await effect()
    const receipted = await settleEffect(ref, kind, claim.claimId, {
      status: result.status,
      ...(result.status === 'skipped' ? { reason: result.reason } : {}),
    })
    return {
      executed: true,
      value: result.value,
      status: receipted ? result.status : 'unavailable',
    }
  } catch (error) {
    await settleEffect(ref, kind, claim.claimId, {
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function claimEffect(
  ref: ServerGenerationEffectLedgerRef,
  kind: GenerationEffectKind,
  delivery: GenerationEffectDelivery,
): Promise<ClaimedEffectResponse | NotClaimedEffectResponse | null> {
  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(
      `/api/v1/generation-effects/${encodeURIComponent(ref.generationId)}/${encodeURIComponent(kind)}/claims`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'risu-auth': auth,
          ...activeWriterSessionHeader(),
          [SERVER_DATABASE_LINEAGE_HEADER]: ref.databaseLineage,
        },
        body: JSON.stringify({ delivery, messageId: ref.messageId }),
      },
    )
  } catch {
    return null
  }
  const body = await readJson(response)
  if (handleActiveWriterStaleResponse(response, body)) return null
  if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  if (record.status === 'claimed' && typeof record.claimId === 'string') {
    return { status: 'claimed', claimId: record.claimId }
  }
  if (record.status === 'not_claimed' && typeof record.reason === 'string') {
    return { status: 'not_claimed', reason: record.reason }
  }
  return null
}

async function settleEffect(
  ref: ServerGenerationEffectLedgerRef,
  kind: GenerationEffectKind,
  claimId: string,
  receipt: { status: 'completed' | 'skipped' | 'failed'; reason?: string; lastError?: string },
): Promise<boolean> {
  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(
      `/api/v1/generation-effects/${encodeURIComponent(ref.generationId)}/${encodeURIComponent(kind)}/receipt`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'risu-auth': auth,
          ...activeWriterSessionHeader(),
          [SERVER_DATABASE_LINEAGE_HEADER]: ref.databaseLineage,
        },
        body: JSON.stringify({ claimId, ...receipt }),
      },
    )
  } catch {
    return false
  }
  const body = await readJson(response)
  if (handleActiveWriterStaleResponse(response, body)) return false
  return response.ok
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function resetGenerationEffectLedgerForTests(): void {
  inFlightEffects.clear()
}
