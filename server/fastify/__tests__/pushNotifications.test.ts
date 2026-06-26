import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import {
  createPushNotificationService,
  listPushSubscriptions,
  type PushNotificationTransport,
} from '../src/pushNotifications.js'
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
    const sent: Array<{ endpoint: string; payload?: string | Buffer | null; topic?: string }> = []
    const transport: PushNotificationTransport = {
      sendNotification: vi.fn(async (subscription, payload, options) => {
        sent.push({ endpoint: subscription.endpoint, payload, topic: options?.topic })
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
      db.prepare('INSERT INTO characters (id, position, data_json) VALUES (?, ?, ?)').run(
        'char-a',
        0,
        JSON.stringify({
          chaId: 'char-a',
          name: 'Character A',
          image: imageAssetId,
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
        icon: `/api/v1/assets/${imageAssetId}`,
        badge: '/logo_192.png',
        url: '/character/char-a/chat-a',
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
})

describe('push notification routes', () => {
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
