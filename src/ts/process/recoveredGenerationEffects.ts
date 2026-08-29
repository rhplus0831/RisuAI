import { getDatabase, type Message } from '../storage/database.svelte'
import { chatOutputListeners, isChatOutputRuntimeReady, runChatOutputListeners } from '../plugins/chatOutputListeners'
import { hydrateChatMessages } from '../server/chatMessageHydration.svelte'
import type { PendingGenerationEffect } from '../server/bootstrap'
import { evaluateIgp } from './postGeneration/igp'
import { loadAndTrimCharEmotion } from './postGeneration/charEmotionStore'
import { runEmotionEmbeddingFallback } from './postGeneration/emotionFallbackEmbedding'
import { runEmotionLlmFallback } from './postGeneration/emotionFallbackLlm'
import { runImggenStableDiff } from './postGeneration/imggenStableDiff'
import { stablePostGenerationMessageTarget } from './postGeneration/stableTarget'
import {
  completedGenerationEffect,
  generationEffectRefFromMessage,
  generationEffectRefFromPending,
  runLedgeredGenerationEffect,
  skippedGenerationEffect,
} from './generationEffectLedger'
import type { ServerGenerationEffectLedgerRef } from '@risuai/protocol/generation-sse'
import type { ActiveChatTarget } from '../chatCommands'
import { registerRecoveredEffectsRuntime } from './generationRuntimeBridge'

let bootstrapPendingEffects: PendingGenerationEffect[] = []

interface RecoveredGenerationResolution {
  character: NonNullable<ReturnType<typeof getDatabase>['characters']>[number]
  chat: NonNullable<ReturnType<typeof getDatabase>['characters']>[number]['chats'][number]
  message: Message
  characterIndex: number
  chatIndex: number
  messageIndex: number
}

export interface RecoveredGenerationEffectResult {
  durableEffectsReconciled: boolean
  allEffectsReconciled: boolean
}

export function setPendingRecoveredGenerationEffects(effects: readonly PendingGenerationEffect[]): void {
  bootstrapPendingEffects = [...effects]
}

export async function reconcilePendingRecoveredGenerationEffects(): Promise<void> {
  const refs = new Map<string, ServerGenerationEffectLedgerRef>()
  for (const effect of bootstrapPendingEffects) {
    const ref = generationEffectRefFromPending(effect)
    refs.set(`${ref.databaseLineage}:${ref.generationId}`, ref)
  }
  for (const ref of refs.values()) {
    await hydrateChatMessages(ref.chatId, { force: true, strict: true })
    const result = await reconcileRecoveredGenerationEffects(ref)
    if (!result.allEffectsReconciled) {
      throw new Error(`Generation effects remain unavailable for ${ref.generationId}`)
    }
  }
  bootstrapPendingEffects = []
}

export async function reconcileAcceptedSendGenerationEffects(
  target: ActiveChatTarget,
  acceptedMessageId: string,
): Promise<RecoveredGenerationEffectResult> {
  const resolution = findAcceptedAssistant(target, acceptedMessageId)
  const ref = resolution
    ? (generationEffectRefFromMessage(resolution.message) ?? legacyGenerationEffectRef(resolution))
    : undefined
  if (!ref) return { durableEffectsReconciled: false, allEffectsReconciled: false }
  return reconcileRecoveredGenerationEffects(ref)
}

export async function reconcileRecoveredGenerationEffects(
  ref: ServerGenerationEffectLedgerRef,
): Promise<RecoveredGenerationEffectResult> {
  // Late delivery never invokes these callbacks: the server atomically turns
  // each pending ephemeral row into a permanent late_recovery skip.
  const unexpectedEphemeral = () => completedGenerationEffect(undefined)
  const ephemeral = await Promise.all([
    runLedgeredGenerationEffect(ref, 'notification', 'late_recovery', unexpectedEphemeral),
    runLedgeredGenerationEffect(ref, 'tts', 'late_recovery', unexpectedEphemeral),
    runLedgeredGenerationEffect(ref, 'completion_sound', 'late_recovery', unexpectedEphemeral),
  ])

  const initial = resolveGeneration(ref)
  if (!initial) return { durableEffectsReconciled: false, allEffectsReconciled: false }
  const completionText = initial.message.data

  // Match the uninterrupted ordering: plugin automation observes the terminal
  // transcript before IGP appends its durable prompt output.
  const plugin = await runLedgeredGenerationEffect(ref, 'plugin_output', 'late_recovery', async (effectContext) => {
    const resolution = resolveGeneration(ref)
    if (!isChatOutputRuntimeReady()) throw new Error('Plugin runtime is not ready for recovered output effects')
    if (!resolution || chatOutputListeners.size === 0) return skippedGenerationEffect('not_configured')
    await runChatOutputListeners({
      char: resolution.character,
      chat: resolution.chat,
      characterIndex: resolution.characterIndex,
      chatIndex: resolution.chatIndex,
      messageIndex: resolution.messageIndex,
      effectIdempotencyKey: effectContext.idempotencyKey,
    })
    return completedGenerationEffect(undefined)
  })

  const igp = await runLedgeredGenerationEffect(ref, 'igp', 'late_recovery', async () => {
    const resolution = resolveGeneration(ref)
    const promptTemplate = getDatabase().igpPrompt ?? ''
    if (!resolution || !promptTemplate.trim()) return skippedGenerationEffect('not_configured')
    const updated = await evaluateIgp({
      promptTemplate,
      abortSignal: new AbortController().signal,
      waitForPersistence: true,
      target: {
        characterId: resolution.character.chaId,
        chatId: resolution.chat.id ?? ref.chatId,
        messageId: ref.messageId,
        expectedData: resolution.message.data,
        ...(resolution.message.generationInfo?.generationId === ref.generationId
          ? { expectedGenerationId: ref.generationId }
          : {}),
      },
    })
    return updated ? completedGenerationEffect(undefined) : skippedGenerationEffect('target_changed')
  })

  const emotion = await runLedgeredGenerationEffect(ref, 'emotion_image_state', 'late_recovery', async () => {
    const resolution = resolveGeneration(ref)
    if (!resolution || resolution.character.inlayViewScreen) {
      return skippedGenerationEffect('current_state_not_applicable')
    }
    if (resolution.character.viewScreen === 'emotion') {
      const { tempEmotion, charemotions } = loadAndTrimCharEmotion(resolution.character.chaId)
      if (getDatabase().emotionProcesser === 'embedding') {
        await runEmotionEmbeddingFallback({
          result: completionText,
          currentChar: resolution.character,
          tempEmotion,
          charemotions,
        })
      } else {
        await runEmotionLlmFallback({
          result: completionText,
          currentChar: resolution.character,
          abortSignal: new AbortController().signal,
          throwError: (error) => console.error(error),
          emotionPrompt2: getDatabase().emotionPrompt2,
          tempEmotion,
          charemotions,
        })
      }
      return completedGenerationEffect(undefined)
    }
    if (resolution.character.viewScreen === 'imggen') {
      await runImggenStableDiff({
        currentChar: resolution.character,
        target: stablePostGenerationMessageTarget(
          resolution.character.chaId,
          resolution.chat.id,
          resolution.message.chatId,
        ),
      })
      return completedGenerationEffect(undefined)
    }
    return skippedGenerationEffect('current_state_not_applicable')
  })

  return {
    durableEffectsReconciled: terminalReceipt(plugin.status) && terminalReceipt(igp.status),
    allEffectsReconciled: [...ephemeral, plugin, igp, emotion].every((effect) => terminalReceipt(effect.status)),
  }
}

function terminalReceipt(status: string): boolean {
  return status === 'completed' || status === 'skipped' || status === 'already_receipted'
}

function legacyGenerationEffectRef(
  resolution: RecoveredGenerationResolution,
): ServerGenerationEffectLedgerRef | undefined {
  const databaseLineage = resolution.message.generationInfo?.databaseLineage?.trim()
  const generationId = resolution.message.generationInfo?.generationId?.trim()
  const messageId = resolution.message.chatId?.trim()
  const characterId = resolution.character.chaId?.trim()
  const chatId = resolution.chat.id?.trim()
  if (!databaseLineage || !generationId || !messageId || !characterId || !chatId) return undefined
  return {
    version: 1,
    databaseLineage,
    keyType: 'generation',
    keyId: generationId,
    generationId,
    characterId,
    chatId,
    messageId,
  }
}

function resolveGeneration(ref: ServerGenerationEffectLedgerRef): RecoveredGenerationResolution | undefined {
  const characters = getDatabase().characters ?? []
  for (let characterIndex = 0; characterIndex < characters.length; characterIndex++) {
    const character = characters[characterIndex]
    for (let chatIndex = 0; chatIndex < (character.chats?.length ?? 0); chatIndex++) {
      const chat = character.chats[chatIndex]
      const messageIndex = chat.message?.findIndex((message) => message.chatId === ref.messageId) ?? -1
      if (messageIndex < 0) continue
      const message = chat.message[messageIndex]
      if (message.role !== 'char' || message.generationInfo?.generationId !== ref.generationId) continue
      return { character, chat, message, characterIndex, chatIndex, messageIndex }
    }
  }
  return undefined
}

function findAcceptedAssistant(
  target: ActiveChatTarget,
  acceptedMessageId: string,
): RecoveredGenerationResolution | undefined {
  const characters = getDatabase().characters ?? []
  const characterIndex = characters.findIndex((character) =>
    target.characterId
      ? character.chaId === target.characterId
      : characters.indexOf(character) === target.selectedCharID,
  )
  const character = characters[characterIndex]
  if (!character) return undefined
  const chatIndex = character.chats.findIndex((chat) =>
    target.chatId ? chat.id === target.chatId : character.chats.indexOf(chat) === target.chatPage,
  )
  const chat = character.chats[chatIndex]
  if (!chat) return undefined
  const acceptedIndex = chat.message.findIndex(
    (message) => message.chatId === acceptedMessageId && message.role === 'user',
  )
  const messageIndex = acceptedIndex + 1
  const message = chat.message[messageIndex]
  if (acceptedIndex < 0 || message?.role !== 'char') return undefined
  return { character, chat, message, characterIndex, chatIndex, messageIndex }
}

registerRecoveredEffectsRuntime({
  reconcilePendingRecoveredGenerationEffects,
  setPendingRecoveredGenerationEffects,
})
