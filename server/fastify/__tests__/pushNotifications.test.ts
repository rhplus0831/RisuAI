import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { buildApp } from '../src/app.js'
import { createAuthState } from '../src/auth.js'
import { openDatabase } from '../src/db.js'
import {
  createPushNotificationService,
  listPushSubscriptions,
  normalizePushEndpoint,
  normalizePushSubscription,
  PUSH_DELIVERY_TIMEOUT_MS,
  type PushNotificationTransport,
} from '../src/pushNotifications.js'
import { PUSH_SUBSCRIPTION_BODY_LIMIT, registerPushNotificationRoutes } from '../src/routes/pushNotifications.js'
import { setupAuthedClient } from './helpers/auth.js'

const dataDirs: string[] = []

function makeDataDir(prefix = 'risu-fastify-push-'): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), prefix))
  dataDirs.push(dataDir)
  return dataDir
}

function sampleSubscription(endpoint = 'https://push.example.test/subscription') {
  return {
    endpoint,
    keys: {
      p256dh: 'p256dh-key',
      auth: 'auth-key',
    },
  }
}

function setNotificationSetting(db: DatabaseSync, enabled: boolean): void {
  const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string } | undefined
  const settings = row ? (JSON.parse(row.data_json) as Record<string, unknown>) : {}
  settings.notification = enabled
  db.prepare('INSERT OR REPLACE INTO settings (id, data_json) VALUES (1, ?)').run(JSON.stringify(settings))
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

describe('push notification service', () => {
  it('stores subscriptions and sends chat completion payloads when notifications are enabled', async () => {
    const db = openDatabase(makeDataDir())
    const sent: Array<{ endpoint: string; payload?: string | Buffer | null; timeout?: number; topic?: string }> = []
    const transport: PushNotificationTransport = {
      sendNotification: vi.fn(async (subscription, payload, options) => {
        sent.push({ endpoint: subscription.endpoint, payload, timeout: options?.timeout, topic: options?.topic })
      }),
    }
    try {
      setNotificationSetting(db, true)
      const service = createPushNotificationService(db, makeDataDir('risu-fastify-push-keys-'), { transport })

      service.upsertSubscription(sampleSubscription())
      await service.sendChatCompletionNotification({ characterId: 'character/id', chatId: 'chat id' })

      expect(sent).toEqual([
        {
          endpoint: 'https://push.example.test/subscription',
          payload: expect.any(String),
          timeout: PUSH_DELIVERY_TIMEOUT_MS,
          topic: 'chat-completion',
        },
      ])
      expect(sent).toHaveLength(1)
      expect(JSON.parse(sent[0].payload as string)).toEqual({
        type: 'chat_completion',
        title: 'Risuai',
        body: 'Chat processing complete.',
        icon: '/logo_192.png',
        badge: '/logo_192.png',
        url: '/character/character%2Fid/chat%20id',
      })
    } finally {
      db.close()
    }
  })

  it('resolves the completion notification route from a chat id when the character id is omitted', async () => {
    const db = openDatabase(makeDataDir())
    const sent: Array<{ payload?: string | Buffer | null }> = []
    const transport: PushNotificationTransport = {
      sendNotification: vi.fn(async (_subscription, payload) => {
        sent.push({ payload })
      }),
    }
    try {
      setNotificationSetting(db, true)
      const imageAssetId = 'a'.repeat(64)
      const notificationImageAssetId = 'b'.repeat(64)
      db.prepare('INSERT INTO characters (id, position, data_json) VALUES (?, ?, ?)').run(
        'char-a',
        0,
        JSON.stringify({
          chaId: 'char-a',
          name: 'Character A',
          image: imageAssetId,
          notificationImage: notificationImageAssetId,
          customNotificationMessage: 'A reply is waiting.',
        }),
      )
      db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)').run(
        'chat-a',
        'char-a',
        0,
        JSON.stringify({ id: 'chat-a', name: 'Chat A' }),
      )
      const service = createPushNotificationService(db, makeDataDir('risu-fastify-push-keys-'), { transport })

      service.upsertSubscription(sampleSubscription())
      await service.sendChatCompletionNotification({ chatId: 'chat-a' })

      expect(sent).toHaveLength(1)
      expect(JSON.parse(sent[0].payload as string)).toMatchObject({
        body: 'A reply is waiting.',
        icon: `/api/v1/assets/${notificationImageAssetId}`,
        badge: '/logo_192.png',
        url: '/character/char-a/chat-a',
      })
    } finally {
      db.close()
    }
  })

  it('falls back to the character image when no notification image is set', async () => {
    const db = openDatabase(makeDataDir())
    const sent: Array<{ payload?: string | Buffer | null }> = []
    const transport: PushNotificationTransport = {
      sendNotification: vi.fn(async (_subscription, payload) => {
        sent.push({ payload })
      }),
    }
    try {
      setNotificationSetting(db, true)
      const imageAssetId = 'c'.repeat(64)
      db.prepare('INSERT INTO characters (id, position, data_json) VALUES (?, ?, ?)').run(
        'char-fallback',
        0,
        JSON.stringify({
          chaId: 'char-fallback',
          name: 'Character Fallback',
          image: imageAssetId,
        }),
      )
      const service = createPushNotificationService(db, makeDataDir('risu-fastify-push-keys-'), { transport })

      service.upsertSubscription(sampleSubscription())
      await service.sendChatCompletionNotification({ characterId: 'char-fallback' })

      expect(sent).toHaveLength(1)
      expect(JSON.parse(sent[0].payload as string)).toMatchObject({
        icon: `/api/v1/assets/${imageAssetId}`,
      })
    } finally {
      db.close()
    }
  })

  it('keeps oversized custom notification messages within a safe push payload size', async () => {
    const db = openDatabase(makeDataDir())
    const sent: Array<{ payload?: string | Buffer | null }> = []
    const transport: PushNotificationTransport = {
      sendNotification: vi.fn(async (_subscription, payload) => {
        if (new TextEncoder().encode(String(payload)).byteLength > 1800) {
          throw new Error('payload too large')
        }
        sent.push({ payload })
      }),
    }
    try {
      setNotificationSetting(db, true)
      db.prepare('INSERT INTO characters (id, position, data_json) VALUES (?, ?, ?)').run(
        'char-long',
        0,
        JSON.stringify({
          chaId: 'char-long',
          name: 'Character Long',
          customNotificationMessage: 'Long custom message '.repeat(400),
        }),
      )
      db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)').run(
        'chat-long',
        'char-long',
        0,
        JSON.stringify({ id: 'chat-long', name: 'Chat Long' }),
      )
      const service = createPushNotificationService(db, makeDataDir('risu-fastify-push-keys-'), { transport })

      service.upsertSubscription(sampleSubscription())
      await service.sendChatCompletionNotification({ chatId: 'chat-long' })

      expect(sent).toHaveLength(1)
      const payload = JSON.parse(sent[0].payload as string) as { body: string }
      expect(payload.body.endsWith('...')).toBe(true)
      expect(new TextEncoder().encode(payload.body).byteLength).toBeLessThanOrEqual(1024)
    } finally {
      db.close()
    }
  })

  it('does not send when the persisted notification setting is disabled', async () => {
    const db = openDatabase(makeDataDir())
    const transport: PushNotificationTransport = {
      sendNotification: vi.fn(async () => {}),
    }
    try {
      setNotificationSetting(db, false)
      const service = createPushNotificationService(db, makeDataDir('risu-fastify-push-keys-'), { transport })

      service.upsertSubscription(sampleSubscription())
      await service.sendChatCompletionNotification()

      expect(transport.sendNotification).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it('reuses its persisted VAPID identity and subscriptions after a database reopen', () => {
    const dataDir = makeDataDir()
    const firstDb = openDatabase(dataDir)
    let firstPublicKey: string | null = null
    try {
      const firstService = createPushNotificationService(firstDb, dataDir)
      firstPublicKey = firstService.publicKey()
      firstService.upsertSubscription(sampleSubscription())
    } finally {
      firstDb.close()
    }

    const reopenedDb = openDatabase(dataDir)
    try {
      const reopenedService = createPushNotificationService(reopenedDb, dataDir)
      expect(reopenedService.publicKey()).toBe(firstPublicKey)
      expect(listPushSubscriptions(reopenedDb)).toEqual([
        { endpoint: sampleSubscription().endpoint, subscription: sampleSubscription() },
      ])
    } finally {
      reopenedDb.close()
    }
  })

  it('prunes expired push subscriptions after a 410 response', async () => {
    const db = openDatabase(makeDataDir())
    const transport: PushNotificationTransport = {
      sendNotification: vi.fn(async () => {
        throw { statusCode: 410 }
      }),
    }
    try {
      setNotificationSetting(db, true)
      const service = createPushNotificationService(db, makeDataDir('risu-fastify-push-keys-'), { transport })

      service.upsertSubscription(sampleSubscription())
      await service.sendChatCompletionNotification()

      expect(listPushSubscriptions(db)).toEqual([])
    } finally {
      db.close()
    }
  })

  it('rejects malformed, insecure, credential-bearing, and oversized subscription fields', () => {
    expect(normalizePushEndpoint('not a URL')).toBeNull()
    expect(normalizePushEndpoint('http://push.example.test/subscription')).toBeNull()
    expect(normalizePushEndpoint('https://user:secret@push.example.test/subscription')).toBeNull()
    expect(normalizePushEndpoint('https://push.example.test/subscription#fragment')).toBeNull()
    expect(normalizePushSubscription(sampleSubscription('http://push.example.test/subscription'))).toBeNull()
    expect(
      normalizePushSubscription({
        ...sampleSubscription(),
        keys: { p256dh: 'x'.repeat(4097), auth: 'auth-key' },
      }),
    ).toBeNull()
  })
})

describe('push notification routes', () => {
  it('authenticates before body parsing and caps subscription bodies before mutation', async () => {
    const dataDir = makeDataDir()
    const upsertSubscription = vi.fn()
    const pushNotifications = {
      publicKey: () => null,
      upsertSubscription,
      deleteSubscription: vi.fn(),
      sendChatCompletionNotification: vi.fn(async () => {}),
    }
    const oversizedPayload = {
      subscription: {
        ...sampleSubscription(),
        keys: { p256dh: 'x'.repeat(PUSH_SUBSCRIPTION_BODY_LIMIT), auth: 'auth-key' },
      },
    }

    const unauthenticatedApp = Fastify({ bodyLimit: 1024 * 1024 })
    registerPushNotificationRoutes(unauthenticatedApp, createAuthState(dataDir), pushNotifications)
    await unauthenticatedApp.ready()
    try {
      const response = await unauthenticatedApp.inject({
        method: 'POST',
        url: '/api/v1/push/subscriptions',
        payload: oversizedPayload,
      })
      expect(response.statusCode).toBe(401)
      expect(upsertSubscription).not.toHaveBeenCalled()
    } finally {
      await unauthenticatedApp.close()
    }

    const authenticatedApp = Fastify({ bodyLimit: 1024 * 1024 })
    registerPushNotificationRoutes(
      authenticatedApp,
      createAuthState(dataDir, { agentDevAuthBypass: true }),
      pushNotifications,
    )
    await authenticatedApp.ready()
    try {
      const response = await authenticatedApp.inject({
        method: 'POST',
        url: '/api/v1/push/subscriptions',
        payload: oversizedPayload,
      })
      expect(response.statusCode).toBe(413)
      expect(upsertSubscription).not.toHaveBeenCalled()
    } finally {
      await authenticatedApp.close()
    }
  })

  it('exposes the public VAPID key and protects subscription mutations', async () => {
    process.env.LOG_LEVEL = 'silent'
    const dataDir = makeDataDir()
    const { app } = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir,
        bodyLimit: 1024 * 1024,
        importMaxBytes: Infinity,
        trustProxy: false,
        hubUrl: 'https://sv.risuai.xyz',
      },
      memoryWorker: false,
    })
    await app.ready()
    try {
      const key = await app.inject({ method: 'GET', url: '/api/v1/push/vapid-public-key' })
      expect(key.statusCode).toBe(200)
      expect(key.json()).toEqual({ publicKey: expect.any(String) })

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/v1/push/subscriptions',
        payload: { subscription: sampleSubscription() },
      })
      expect(blocked.statusCode).toBe(401)

      const { assertion } = await setupAuthedClient(app)
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/v1/push/subscriptions',
        headers: { 'risu-auth': assertion },
        payload: { subscription: { endpoint: '' } },
      })
      expect(invalid.statusCode).toBe(400)

      const insecure = await app.inject({
        method: 'POST',
        url: '/api/v1/push/subscriptions',
        headers: { 'risu-auth': assertion },
        payload: { subscription: sampleSubscription('http://push.example.test/subscription') },
      })
      expect(insecure.statusCode).toBe(400)

      const stored = await app.inject({
        method: 'POST',
        url: '/api/v1/push/subscriptions',
        headers: { 'risu-auth': assertion },
        payload: { subscription: sampleSubscription() },
      })
      expect(stored.statusCode).toBe(200)
      expect(stored.json()).toEqual({ status: 'ok' })

      const removed = await app.inject({
        method: 'DELETE',
        url: '/api/v1/push/subscriptions',
        headers: { 'risu-auth': assertion },
        payload: { endpoint: sampleSubscription().endpoint },
      })
      expect(removed.statusCode).toBe(200)
      expect(removed.json()).toEqual({ status: 'ok' })
    } finally {
      await app.close()
    }
  })
})
