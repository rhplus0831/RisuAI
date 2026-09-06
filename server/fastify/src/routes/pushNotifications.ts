import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { normalizePushEndpoint, normalizePushSubscription, type PushNotificationService } from '../pushNotifications.js'

interface PushSubscriptionBody {
  subscription?: unknown
}

interface DeletePushSubscriptionBody {
  endpoint?: unknown
}

export const PUSH_SUBSCRIPTION_BODY_LIMIT = 16 * 1024

export function registerPushNotificationRoutes(
  app: FastifyInstance,
  authState: AuthState,
  pushNotifications: PushNotificationService,
): void {
  app.get('/api/v1/push/vapid-public-key', async () => {
    return { publicKey: pushNotifications.publicKey() }
  })

  app.post(
    '/api/v1/push/subscriptions',
    {
      bodyLimit: PUSH_SUBSCRIPTION_BODY_LIMIT,
      onRequest: async (req, reply) => {
        await requireAuth(authState, req, reply)
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as PushSubscriptionBody
      const subscription = normalizePushSubscription(body.subscription)
      if (!subscription) {
        reply.code(400).send({ error: 'subscription is invalid' })
        return
      }

      pushNotifications.upsertSubscription(subscription)
      return { status: 'ok' }
    },
  )

  app.delete(
    '/api/v1/push/subscriptions',
    {
      bodyLimit: PUSH_SUBSCRIPTION_BODY_LIMIT,
      onRequest: async (req, reply) => {
        await requireAuth(authState, req, reply)
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as DeletePushSubscriptionBody
      const endpoint = normalizePushEndpoint(body.endpoint)
      if (!endpoint) {
        reply.code(400).send({ error: 'endpoint is invalid' })
        return
      }

      pushNotifications.deleteSubscription(endpoint)
      return { status: 'ok' }
    },
  )
}
