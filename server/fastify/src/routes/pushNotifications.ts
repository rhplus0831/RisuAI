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

export function registerPushNotificationRoutes(
  app: FastifyInstance,
  authState: AuthState,
  pushNotifications: PushNotificationService,
): void {
  app.get('/api/v1/push/vapid-public-key', async () => {
    return { publicKey: pushNotifications.publicKey() }
  })

  app.post('/api/v1/push/subscriptions', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as PushSubscriptionBody
    const subscription = normalizePushSubscription(body.subscription)
    if (!subscription) {
      reply.code(400).send({ error: 'subscription is invalid' })
      return
    }

    pushNotifications.upsertSubscription(subscription)
    return { status: 'ok' }
  })

  app.delete('/api/v1/push/subscriptions', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as DeletePushSubscriptionBody
    const endpoint = normalizePushEndpoint(body.endpoint)
    if (!endpoint) {
      reply.code(400).send({ error: 'endpoint is invalid' })
      return
    }

    pushNotifications.deleteSubscription(endpoint)
    return { status: 'ok' }
  })
}
