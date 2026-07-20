import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createCommandEventSink } from '../src/commands/events.js'
import { openDatabase } from '../src/db.js'
import { MessageTranslationJobRegistry } from '../src/messageTranslationJobs.js'
import type { PushNotificationService } from '../src/pushNotifications.js'
import { writePersistedWithMessages } from '../src/repository.js'
import {
  DEFAULT_AUTO_TRANSLATE_NOTIFICATION_DEFER_CAP_SECONDS,
  autoTranslateNotificationDeferCapSeconds,
  handleGeneratedChatCompletion,
  type ServerMessageTranslationRunner,
} from '../src/translation/generationCompletionTranslation.js'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let dataDir: string
let db: DatabaseSync
let sendChatCompletionNotification: PushNotificationService['sendChatCompletionNotification']
let pushNotifications: PushNotificationService

function seedCompletion(
  settings: {
    notification?: boolean
    cap?: number
    autoTranslate?: boolean
    translator?: string
    translatorType?: string
    autoTranslateCachedOnly?: boolean
  } = {},
): void {
  writePersistedWithMessages(db, dataDir, {
    _version: 1,
    database: {
      notification: settings.notification ?? true,
      translator: settings.translator ?? 'ko',
      translatorType: settings.translatorType ?? 'google',
      autoTranslateCachedOnly: settings.autoTranslateCachedOnly ?? false,
      ...(settings.cap === undefined ? {} : { autoTranslateNotificationDeferCapSeconds: settings.cap }),
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'Chat',
              note: '',
              localLore: [],
              autoTranslate: settings.autoTranslate ?? true,
              message: [{ role: 'char', data: 'Generated reply', chatId: 'message-a' }],
            },
          ],
          chatPage: 0,
          chatFolders: [],
        },
      ],
      characterOrder: ['char-a'],
    },
    assets: [],
  })
}

function complete(disconnected: boolean, runMessageTranslation: ServerMessageTranslationRunner) {
  return handleGeneratedChatCompletion({
    db,
    dataDir,
    eventSink: createCommandEventSink(),
    messageTranslationJobs: new MessageTranslationJobRegistry(),
    messageId: 'message-a',
    chatId: 'chat-a',
    characterId: 'char-a',
    disconnected,
    pushNotifications,
    runMessageTranslation,
  })
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-completion-translation-'))
  db = openDatabase(dataDir)
  sendChatCompletionNotification = vi.fn(async () => {})
  pushNotifications = {
    publicKey: () => 'test-key',
    upsertSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    sendChatCompletionNotification,
  }
})

afterEach(() => {
  vi.useRealTimers()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('generated chat completion translation follow-up', () => {
  it('keeps connected completion behavior immediate and client-driven', () => {
    seedCompletion()
    const runTranslation = vi.fn() as unknown as ServerMessageTranslationRunner

    const followup = complete(false, runTranslation)

    expect(followup).toMatchObject({ translationStarted: false, notification: 'immediate' })
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
    expect(runTranslation).not.toHaveBeenCalled()
  })

  it('defers a disconnected eligible completion push until translation settles', async () => {
    seedCompletion()
    const translation = deferred<never>()
    const runTranslation = vi.fn(() => translation.promise) as unknown as ServerMessageTranslationRunner

    const followup = complete(true, runTranslation)
    expect(followup).toMatchObject({ translationStarted: true, notification: 'deferred' })
    expect(sendChatCompletionNotification).not.toHaveBeenCalled()

    translation.resolve({} as never)
    await followup.translation

    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('pushes immediately when the disconnected translation fails', async () => {
    seedCompletion()
    const translation = deferred<never>()
    const runTranslation = vi.fn(() => translation.promise) as unknown as ServerMessageTranslationRunner
    const followup = complete(true, runTranslation)

    translation.reject(new Error('provider failed'))
    await expect(followup.translation).rejects.toThrow('provider failed')

    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('fires the cap once while allowing translation persistence to finish later', async () => {
    vi.useFakeTimers()
    seedCompletion({ cap: 2 })
    const translation = deferred<never>()
    let translationPersisted = false
    const runTranslation = vi.fn(async () => {
      await translation.promise
      translationPersisted = true
      return {} as never
    }) as unknown as ServerMessageTranslationRunner
    const followup = complete(true, runTranslation)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
    expect(translationPersisted).toBe(false)

    translation.resolve({} as never)
    await followup.translation
    expect(translationPersisted).toBe(true)
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('treats cap zero as unlimited and waits for settlement', async () => {
    vi.useFakeTimers()
    seedCompletion({ cap: 0 })
    const translation = deferred<never>()
    const runTranslation = vi.fn(() => translation.promise) as unknown as ServerMessageTranslationRunner
    const followup = complete(true, runTranslation)

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(sendChatCompletionNotification).not.toHaveBeenCalled()

    translation.resolve({} as never)
    await followup.translation
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('still runs translation with push disabled and never calls the push service', async () => {
    seedCompletion({ notification: false })
    const translation = deferred<never>()
    const runTranslation = vi.fn(() => translation.promise) as unknown as ServerMessageTranslationRunner
    const followup = complete(true, runTranslation)

    expect(followup).toMatchObject({ translationStarted: true, notification: 'disabled' })
    expect(runTranslation).toHaveBeenCalledTimes(1)
    translation.resolve({} as never)
    await followup.translation
    expect(sendChatCompletionNotification).not.toHaveBeenCalled()
  })

  it('uses 180 seconds when the persisted scalar is missing', () => {
    expect(autoTranslateNotificationDeferCapSeconds({})).toBe(DEFAULT_AUTO_TRANSLATE_NOTIFICATION_DEFER_CAP_SECONDS)
    expect(autoTranslateNotificationDeferCapSeconds({ autoTranslateNotificationDeferCapSeconds: 0 })).toBe(0)
  })
})
