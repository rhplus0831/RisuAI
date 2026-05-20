import type { FastifyRequest } from 'fastify'

export function extractRisuAuth(req: FastifyRequest): string {
  const raw = req.headers['risu-auth']
  if (Array.isArray(raw)) {
    return typeof raw[0] === 'string' ? raw[0] : ''
  }
  return typeof raw === 'string' ? raw : ''
}
