import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { type AuthState, hasPassword, verifyAssertion } from '../auth.js'
import { extractRisuAuth } from '../http.js'
import { ValidationError, applyImport } from '../repository.js'

interface ImportBody {
  database?: unknown
}

async function requireAuth(
  state: AuthState,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (!hasPassword(state)) return true
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
  return true
}

export function registerSaveRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
): void {
  app.post('/api/v1/import/risusave', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const body = (req.body ?? {}) as ImportBody
    try {
      const { revision } = applyImport(db, dataDir, body.database)
      return { revision, assetReport: { referencedCount: 0, missingCount: 0, orphanedCount: 0 } }
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      throw err
    }
  })
}
