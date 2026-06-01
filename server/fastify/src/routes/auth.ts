import type { FastifyInstance } from 'fastify'
import {
  type AuthState,
  hasPassword,
  passwordMatches,
  registerPublicKey,
  setPassword,
  verifyAssertion,
} from '../auth.js'
import { extractRisuAuth } from '../http.js'
import { authLoginRateLimit, authSetupRateLimit } from '../routeRateLimits.js'

interface LoginBody {
  password?: unknown
  publicKey?: unknown
}

interface SetupBody {
  password?: unknown
  publicKey?: unknown
}

export function registerAuthRoutes(app: FastifyInstance, state: AuthState): void {
  app.get('/api/v1/auth/status', async (req) => {
    const token = extractRisuAuth(req)
    if (!hasPassword(state)) {
      return { noPassword: true, authorized: false }
    }
    if (!token) {
      return { noPassword: false, authorized: false }
    }
    const result = await verifyAssertion(state, token)
    return { noPassword: false, authorized: result.ok }
  })

  app.post(
    '/api/v1/auth/setup',
    { config: { rateLimit: authSetupRateLimit } },
    async (req, reply) => {
      const body = (req.body ?? {}) as SetupBody
      if (typeof body.password !== 'string' || body.password.length === 0) {
        reply.code(400)
        return { error: 'Password required' }
      }
      if (hasPassword(state)) {
        reply.code(400)
        return { error: 'Password already set' }
      }
      setPassword(state, body.password)
      if (typeof body.publicKey === 'object' && body.publicKey !== null) {
        registerPublicKey(state, body.publicKey)
      }
      return { status: 'success' }
    },
  )

  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: authLoginRateLimit } },
    async (req, reply) => {
      const body = (req.body ?? {}) as LoginBody
      if (!hasPassword(state)) {
        reply.code(400)
        return { error: 'Password not set' }
      }
      if (
        typeof body.password !== 'string' ||
        typeof body.publicKey !== 'object' ||
        body.publicKey === null
      ) {
        reply.code(400)
        return { error: 'Invalid payload' }
      }
      if (!passwordMatches(state, body.password)) {
        reply.code(400)
        return { error: 'Password incorrect' }
      }
      registerPublicKey(state, body.publicKey)
      return { status: 'success' }
    },
  )
}
