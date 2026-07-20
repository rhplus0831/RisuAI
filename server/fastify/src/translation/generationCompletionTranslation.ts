import type { DatabaseSync } from 'node:sqlite'
import { normalizeAllCharacterChats, requireChatLocation } from '../commands/chats.js'
import type { CommandEventSink } from '../commands/events.js'
import type { MessageTranslationJobRegistry } from '../messageTranslationJobs.js'
import { resolveActiveMessageLocationById } from '../messageStore.js'
import {
  chatCompletionNotificationSettingEnabled,
  type ChatCompletionNotificationContext,
  type PushNotificationService,
} from '../pushNotifications.js'
import { loadPersistedForChatMutation, loadSettingsFromSqlite } from '../repository.js'
import { isServerAutoTranslationEligible } from './serverAutoTranslationEligibility.js'
import { runServerMessageTranslation, type RunServerMessageTranslationInput } from './serverMessageTranslation.js'

export const DEFAULT_AUTO_TRANSLATE_NOTIFICATION_DEFER_CAP_SECONDS = 180

export type ServerMessageTranslationRunner = (
  input: RunServerMessageTranslationInput,
) => Promise<Awaited<ReturnType<typeof runServerMessageTranslation>>>

export interface GeneratedChatCompletionInput {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  messageTranslationJobs: MessageTranslationJobRegistry
  messageId: string
  chatId: string
  characterId?: string
  completedAt?: number
  disconnected: boolean
  pushNotifications?: false | PushNotificationService
  runMessageTranslation?: ServerMessageTranslationRunner
}

export interface GeneratedChatCompletionFollowup {
  translationStarted: boolean
  translation?: Promise<unknown>
  notification: 'immediate' | 'deferred' | 'disabled'
}

export function autoTranslateNotificationDeferCapSeconds(settings: Record<string, unknown>): number {
  const raw = settings.autoTranslateNotificationDeferCapSeconds
  if (raw === undefined) return DEFAULT_AUTO_TRANSLATE_NOTIFICATION_DEFER_CAP_SECONDS
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return DEFAULT_AUTO_TRANSLATE_NOTIFICATION_DEFER_CAP_SECONDS
  }
  return Math.floor(raw)
}

function notifyChatCompletion(
  pushNotifications: false | PushNotificationService | undefined,
  context: ChatCompletionNotificationContext,
): void {
  if (!pushNotifications) return
  void pushNotifications.sendChatCompletionNotification(context).catch(() => {
    // Best-effort: failed push delivery must not affect completion follow-up.
  })
}

function generatedMessageIsEligible(input: GeneratedChatCompletionInput, settings: Record<string, unknown>): boolean {
  const resolved = resolveActiveMessageLocationById(input.db, input.messageId)
  if (resolved.ok === false || resolved.location.chatId !== input.chatId) return false
  const persisted = loadPersistedForChatMutation(input.db, input.dataDir, { messageId: input.messageId })
  const characters = normalizeAllCharacterChats(persisted.database)
  const { chat } = requireChatLocation(characters, input.chatId)
  return isServerAutoTranslationEligible({
    chatAutoTranslate: chat.autoTranslate,
    messageText: resolved.location.message.data,
    translator: settings.translator,
    translatorType: settings.translatorType,
    autoTranslateCachedOnly: settings.autoTranslateCachedOnly,
  })
}

/**
 * Completes the notification/translation follow-up after a generated message
 * has committed. Connected completions preserve the existing immediate push.
 * A disconnected eligible completion starts a detached translation and, when
 * notifications are enabled, races its settlement against the configured cap.
 */
export function handleGeneratedChatCompletion(input: GeneratedChatCompletionInput): GeneratedChatCompletionFollowup {
  const context = { characterId: input.characterId, chatId: input.chatId }
  if (!input.disconnected) {
    notifyChatCompletion(input.pushNotifications, context)
    return { translationStarted: false, notification: 'immediate' }
  }

  let settings: Record<string, unknown> | null = null
  let eligible = false
  try {
    settings = loadSettingsFromSqlite(input.db)
    eligible = settings !== null && generatedMessageIsEligible(input, settings)
  } catch {
    eligible = false
  }
  if (!eligible || !settings) {
    notifyChatCompletion(input.pushNotifications, context)
    return { translationStarted: false, notification: 'immediate' }
  }

  const runTranslation = input.runMessageTranslation ?? runServerMessageTranslation
  const translation = runTranslation({
    db: input.db,
    dataDir: input.dataDir,
    eventSink: input.eventSink,
    messageTranslationJobs: input.messageTranslationJobs,
    messageId: input.messageId,
  })

  if (!input.pushNotifications || !chatCompletionNotificationSettingEnabled(input.db)) {
    void translation.catch(() => {})
    return { translationStarted: true, translation, notification: 'disabled' }
  }

  let notificationSent = false
  let capTimer: ReturnType<typeof setTimeout> | undefined
  const notifyOnce = (): void => {
    if (notificationSent) return
    notificationSent = true
    if (capTimer) clearTimeout(capTimer)
    notifyChatCompletion(input.pushNotifications, context)
  }
  const capSeconds = autoTranslateNotificationDeferCapSeconds(settings)
  if (capSeconds > 0) {
    const elapsedMs = Math.max(0, Date.now() - (input.completedAt ?? Date.now()))
    capTimer = setTimeout(notifyOnce, Math.max(0, capSeconds * 1000 - elapsedMs))
    capTimer.unref?.()
  }
  void translation.then(notifyOnce, notifyOnce)
  return { translationStarted: true, translation, notification: 'deferred' }
}
