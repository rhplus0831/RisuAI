import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import webPush, { type PushSubscription } from 'web-push'

const VAPID_KEYS_FILE = '__web_push_vapid_keys.json'
const DEFAULT_VAPID_SUBJECT = 'mailto:risuai@example.invalid'
export interface StoredPushSubscription {
  endpoint: string
  subscription: PushSubscription
}

export interface ChatCompletionNotificationContext {
  characterId?: string
  chatId?: string
}

export interface PushNotificationTransport {
  sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer | null,
    options?: webPush.RequestOptions,
  ): Promise<unknown>
}

export interface PushNotificationService {
  publicKey(): string | null
  upsertSubscription(subscription: PushSubscription): void
  deleteSubscription(endpoint: string): void
  sendChatCompletionNotification(context?: ChatCompletionNotificationContext): Promise<void>
}

export interface PushNotificationServiceOptions {
  env?: NodeJS.ProcessEnv
  transport?: PushNotificationTransport
  vapidSubject?: string
}

interface VapidKeyPair {
  publicKey: string
  privateKey: string
}

interface WebPushError {
  statusCode?: number
  body?: unknown
  message?: string
}

export function createPushSubscriptionsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription_json TEXT NOT NULL CHECK (json_valid(subscription_json)),
      failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_updated_at
      ON push_subscriptions (updated_at);
  `)
}

export function createPushNotificationService(
  db: DatabaseSync,
  dataDir: string,
  options: PushNotificationServiceOptions = {},
): PushNotificationService {
  createPushSubscriptionsTable(db)
  const env = options.env ?? process.env
  const vapidKeys = loadOrCreateVapidKeys(dataDir, env)
  if (!vapidKeys) {
    return createDisabledPushNotificationService()
  }

  const subject = options.vapidSubject ?? env.RISU_WEB_PUSH_CONTACT ?? DEFAULT_VAPID_SUBJECT
  const transport = options.transport ?? webPush
  webPush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey)

  return {
    publicKey: () => vapidKeys.publicKey,
    upsertSubscription(subscription) {
      upsertPushSubscription(db, subscription)
    },
    deleteSubscription(endpoint) {
      deletePushSubscription(db, endpoint)
    },
    async sendChatCompletionNotification(context) {
      if (!notificationSettingEnabled(db)) return
      await sendPushNotificationToAll(
        db,
        transport,
        buildChatCompletionNotificationPayload(resolveContext(db, context)),
      )
    },
  }
}

function createDisabledPushNotificationService(): PushNotificationService {
  return {
    publicKey: () => null,
    upsertSubscription: () => {},
    deleteSubscription: () => {},
    sendChatCompletionNotification: async () => {},
  }
}

function loadOrCreateVapidKeys(dataDir: string, env: NodeJS.ProcessEnv): VapidKeyPair | null {
  const publicKey = env.RISU_WEB_PUSH_VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.RISU_WEB_PUSH_VAPID_PRIVATE_KEY?.trim()
  if (publicKey || privateKey) {
    return publicKey && privateKey ? { publicKey, privateKey } : null
  }

  const keysPath = path.join(dataDir, VAPID_KEYS_FILE)
  const stored = readStoredVapidKeys(keysPath)
  if (stored) return stored

  const generated = webPush.generateVAPIDKeys()
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(keysPath, JSON.stringify(generated, null, 2), 'utf-8')
  return generated
}

function readStoredVapidKeys(keysPath: string): VapidKeyPair | null {
  if (!fs.existsSync(keysPath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(keysPath, 'utf-8')) as Partial<VapidKeyPair>
    if (typeof parsed.publicKey === 'string' && typeof parsed.privateKey === 'string') {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey }
    }
  } catch {
    // Regenerate below.
  }
  return null
}

export function normalizePushSubscription(value: unknown): PushSubscription | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const endpoint = record.endpoint
  const keys = record.keys
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 4096) return null
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return null
  const keyRecord = keys as Record<string, unknown>
  if (typeof keyRecord.p256dh !== 'string' || keyRecord.p256dh.length === 0) return null
  if (typeof keyRecord.auth !== 'string' || keyRecord.auth.length === 0) return null

  const expirationTime = record.expirationTime
  const subscription: PushSubscription = {
    endpoint,
    keys: {
      p256dh: keyRecord.p256dh,
      auth: keyRecord.auth,
    },
  }

  if (typeof expirationTime === 'number') {
    subscription.expirationTime = expirationTime
  }

  return subscription
}

export function normalizePushEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const endpoint = value.trim()
  if (endpoint.length === 0 || endpoint.length > 4096) return null
  return endpoint
}

export function buildChatCompletionNotificationPayload(context: ChatCompletionNotificationContext = {}): string {
  return JSON.stringify({
    type: 'chat_completion',
    title: 'Risuai',
    body: 'Chat processing complete.',
    url: chatCompletionNotificationUrl(context),
  })
}

function chatCompletionNotificationUrl(context: ChatCompletionNotificationContext): string {
  if (!isNonEmptyString(context.characterId) || !isNonEmptyString(context.chatId)) return '/'
  return `/character/${encodeURIComponent(context.characterId)}/${encodeURIComponent(context.chatId)}`
}

function resolveContext(
  db: DatabaseSync,
  context: ChatCompletionNotificationContext | undefined,
): ChatCompletionNotificationContext {
  if (isNonEmptyString(context?.characterId) || !isNonEmptyString(context?.chatId)) {
    return context ?? {}
  }

  const characterId = findCharacterIdForChat(db, context.chatId)
  return characterId ? { ...context, characterId } : context
}

function findCharacterIdForChat(db: DatabaseSync, chatId: string): string | null {
  try {
    const row = db.prepare('SELECT character_id AS characterId FROM chats WHERE id = ? LIMIT 1').get(chatId) as
      | { characterId?: unknown }
      | undefined
    return typeof row?.characterId === 'string' && row.characterId.length > 0 ? row.characterId : null
  } catch {
    return null
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function upsertPushSubscription(db: DatabaseSync, subscription: PushSubscription): void {
  db.prepare(
    `
      INSERT INTO push_subscriptions (endpoint, subscription_json, failure_count, last_error, updated_at)
      VALUES (?, ?, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(endpoint) DO UPDATE SET
        subscription_json = excluded.subscription_json,
        failure_count = 0,
        last_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `,
  ).run(subscription.endpoint, JSON.stringify(subscription))
}

export function deletePushSubscription(db: DatabaseSync, endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
}

export function listPushSubscriptions(db: DatabaseSync): StoredPushSubscription[] {
  const rows = db
    .prepare('SELECT endpoint, subscription_json FROM push_subscriptions ORDER BY updated_at DESC')
    .all() as Array<{ endpoint: string; subscription_json: string }>
  const subscriptions: StoredPushSubscription[] = []
  for (const row of rows) {
    try {
      const subscription = normalizePushSubscription(JSON.parse(row.subscription_json))
      if (subscription) {
        subscriptions.push({ endpoint: row.endpoint, subscription })
      }
    } catch {
      markPushSubscriptionFailure(db, row.endpoint, 'stored subscription JSON is invalid')
    }
  }
  return subscriptions
}

async function sendPushNotificationToAll(
  db: DatabaseSync,
  transport: PushNotificationTransport,
  payload: string,
): Promise<void> {
  const subscriptions = listPushSubscriptions(db)
  await Promise.all(
    subscriptions.map(async ({ endpoint, subscription }) => {
      try {
        await transport.sendNotification(subscription, payload, {
          TTL: 60 * 60,
          urgency: 'normal',
          topic: 'chat-completion',
        })
        clearPushSubscriptionFailure(db, endpoint)
      } catch (err) {
        if (isExpiredPushSubscriptionError(err)) {
          deletePushSubscription(db, endpoint)
          return
        }
        markPushSubscriptionFailure(db, endpoint, pushErrorMessage(err))
      }
    }),
  )
}

function isExpiredPushSubscriptionError(err: unknown): boolean {
  const statusCode = typeof err === 'object' && err !== null ? (err as WebPushError).statusCode : undefined
  return statusCode === 404 || statusCode === 410
}

function pushErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const webPushError = err as WebPushError
    if (typeof webPushError.message === 'string') return webPushError.message
    if (typeof webPushError.body === 'string') return webPushError.body
  }
  return String(err)
}

function markPushSubscriptionFailure(db: DatabaseSync, endpoint: string, error: string): void {
  db.prepare(
    `
      UPDATE push_subscriptions
      SET failure_count = failure_count + 1,
          last_error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE endpoint = ?
    `,
  ).run(error.slice(0, 2048), endpoint)
}

function clearPushSubscriptionFailure(db: DatabaseSync, endpoint: string): void {
  db.prepare(
    `
      UPDATE push_subscriptions
      SET failure_count = 0,
          last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE endpoint = ?
    `,
  ).run(endpoint)
}

function notificationSettingEnabled(db: DatabaseSync): boolean {
  try {
    const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string } | undefined
    if (!row) return false
    const settings = JSON.parse(row.data_json) as { notification?: unknown }
    return settings.notification === true
  } catch {
    return false
  }
}
