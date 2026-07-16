import type { FastifyReply, FastifyRequest } from 'fastify'
import { type AuthState, hasPassword, isAgentDevAuthBypassed, verifyAssertion } from './auth.js'

const authenticatedRequests = new WeakSet<FastifyRequest>()

export const PREFER_RETURN_MINIMAL = 'return=minimal'

export function prefersMinimalResponse(prefer: string | string[] | undefined): boolean {
  const preferences = Array.isArray(prefer) ? prefer : [prefer]
  return preferences.some((header) =>
    header
      ?.split(',')
      .some((preference) => preference.trim().split(';', 1)[0]?.toLowerCase() === PREFER_RETURN_MINIMAL),
  )
}

export function extractRisuAuth(req: FastifyRequest): string {
  const raw = req.headers['risu-auth']
  if (Array.isArray(raw)) {
    return typeof raw[0] === 'string' ? raw[0] : ''
  }
  return typeof raw === 'string' ? raw : ''
}

export async function requireAuth(state: AuthState, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (authenticatedRequests.has(req)) return true
  if (isAgentDevAuthBypassed(state)) {
    authenticatedRequests.add(req)
    return true
  }
  if (!hasPassword(state)) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  const token = extractRisuAuth(req)
  if (!token) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  const result = await verifyAssertion(state, token)
  if (!result.ok) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  authenticatedRequests.add(req)
  return true
}
