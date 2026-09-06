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

const persistedTranslation = {
  source: 'raw' as const,
  text: '번역됨',
  sourceHash: 'source-hash',
  targetLanguage: 'ko',
  inputLanguage: 'en',
  translatorType: 'google' as const,
  settingsHash: 'settings-hash',
  updatedAt: 123,
}

function translationResult(jobId = 'unused') {
  return {
    revision: 2,
    event: {
      type: 'messageUpdated' as const,
      revision: 2,
      resource: 'chatMessages',
      id: 'message-a',
      parentId: 'chat-a',
    },
    jobId,
    chatId: 'chat-a',
    messageId: 'message-a',
    translation: persistedTranslation,
  }
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

function complete(runMessageTranslation: ServerMessageTranslationRunner, completedAt?: number) {
  return handleGeneratedChatCompletion({
    db,
    dataDir,
    eventSink: createCommandEventSink(),
    messageTranslationJobs: new MessageTranslationJobRegistry(),
    messageId: 'message-a',
    chatId: 'chat-a',
    characterId: 'char-a',
    completedAt,
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
  it('starts and holds a connected eligible completion, then returns the succeeded frame and pushes once', async () => {
    seedCompletion()
    const translation = deferred<ReturnType<typeof translationResult>>()
    const runTranslation = vi.fn((_input: Parameters<ServerMessageTranslationRunner>[0]) => translation.promise)

    const completion = complete(runTranslation)
    expect(runTranslation).toHaveBeenCalledTimes(1)
    expect(sendChatCompletionNotification).not.toHaveBeenCalled()

    const jobId = runTranslation.mock.calls[0]![0].jobId!
    translation.resolve(translationResult(jobId))
    const followup = await completion

    expect(followup).toMatchObject({
      translationStarted: true,
      notification: 'deferred',
      frame: { status: 'succeeded', jobId, translation: persistedTranslation },
    })
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('returns a failed frame and pushes exactly once when translation rejects', async () => {
    seedCompletion()
    const translation = deferred<ReturnType<typeof translationResult>>()
    const runTranslation = vi.fn((_input: Parameters<ServerMessageTranslationRunner>[0]) => translation.promise)
    const completion = complete(runTranslation)

    translation.reject(new Error('provider failed'))
    const followup = await completion

    expect(followup.frame).toMatchObject({ status: 'failed', error: 'provider failed' })
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('returns running at the cap, pushes once, and leaves translation running detached', async () => {
    vi.useFakeTimers()
    seedCompletion({ cap: 2 })
    const translation = deferred<ReturnType<typeof translationResult>>()
    let translationPersisted = false
    const runTranslation = vi.fn(async (input: Parameters<ServerMessageTranslationRunner>[0]) => {
      const result = await translation.promise
      translationPersisted = true
      return { ...result, jobId: input.jobId }
    })
    const completion = complete(runTranslation)

    await vi.advanceTimersByTimeAsync(2_000)
    const followup = await completion
    expect(followup.frame).toMatchObject({ status: 'running', jobId: runTranslation.mock.calls[0]![0].jobId })
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
    expect(translationPersisted).toBe(false)

    translation.resolve(translationResult())
    await followup.translation
    expect(translationPersisted).toBe(true)
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('counts the cap from completedAt', async () => {
    vi.useFakeTimers()
    seedCompletion({ cap: 2 })
    const translation = deferred<ReturnType<typeof translationResult>>()
    const runTranslation = vi.fn((_input: Parameters<ServerMessageTranslationRunner>[0]) => translation.promise)
    const completion = complete(runTranslation, Date.now() - 1_500)

    await vi.advanceTimersByTimeAsync(499)
    expect(sendChatCompletionNotification).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await completion).frame?.status).toBe('running')
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('treats cap zero as unlimited and waits for settlement', async () => {
    vi.useFakeTimers()
    seedCompletion({ cap: 0 })
    const translation = deferred<ReturnType<typeof translationResult>>()
    const runTranslation = vi.fn((_input: Parameters<ServerMessageTranslationRunner>[0]) => translation.promise)
    const completion = complete(runTranslation)

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(sendChatCompletionNotification).not.toHaveBeenCalled()

    translation.resolve(translationResult(runTranslation.mock.calls[0]![0].jobId))
    expect((await completion).frame?.status).toBe('succeeded')
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('still holds and translates with notifications disabled', async () => {
    seedCompletion({ notification: false })
    const runTranslation = vi.fn(async (input: Parameters<ServerMessageTranslationRunner>[0]) =>
      translationResult(input.jobId),
    )

    const followup = await complete(runTranslation)

    expect(followup).toMatchObject({
      translationStarted: true,
      notification: 'disabled',
      frame: { status: 'succeeded' },
    })
    expect(sendChatCompletionNotification).not.toHaveBeenCalled()
  })

  it('keeps non-eligible completion notification immediate and does not translate', async () => {
    seedCompletion({ autoTranslate: false })
    const runTranslation = vi.fn() as unknown as ServerMessageTranslationRunner

    const followup = await complete(runTranslation)

    expect(followup).toEqual({ translationStarted: false, notification: 'immediate' })
    expect(runTranslation).not.toHaveBeenCalled()
    expect(sendChatCompletionNotification).toHaveBeenCalledTimes(1)
  })

  it('uses 180 seconds when the persisted scalar is missing', () => {
    expect(autoTranslateNotificationDeferCapSeconds({})).toBe(DEFAULT_AUTO_TRANSLATE_NOTIFICATION_DEFER_CAP_SECONDS)
    expect(autoTranslateNotificationDeferCapSeconds({ autoTranslateNotificationDeferCapSeconds: 0 })).toBe(0)
  })
})
