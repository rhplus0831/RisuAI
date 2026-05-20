import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { type AuthState, hasPassword, verifyAssertion } from '../auth.js'
import { extractRisuAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import { loadPersisted } from '../repository.js'

export const ASSET_BASE_URL = '/api/v1/assets'

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

export function registerBootstrapRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
): void {
  app.get('/api/v1/bootstrap', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { version, revision } = getSchemaState(db)
    const persisted = loadPersisted(dataDir)
    return {
      revision,
      schemaVersion: version,
      database: persisted.database,
      assetBaseUrl: ASSET_BASE_URL,
    }
  })
}
