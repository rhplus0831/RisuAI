import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { getSchemaState } from '../db.js'

export function registerHealthRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/v1/health', async () => {
    const { version, revision } = getSchemaState(db)
    return { status: 'ok', revision, schemaVersion: version }
  })
}
