import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import type { CommandEventSink } from '../commands/events.js'
import { requireAuth } from '../http.js'
import { EntityNotFoundError, createBackup, deleteBackup, listBackups, restoreBackup } from '../repository.js'

interface CreateBody {
  label?: unknown
}

export function registerBackupRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
): void {
  app.post('/api/v1/backups', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const body = (req.body ?? {}) as CreateBody
    let label: string | null = null
    if (body.label !== undefined && body.label !== null) {
      if (typeof body.label !== 'string') {
        reply.code(400)
        return { error: 'label must be a string' }
      }
      label = body.label
    }
    const manifest = createBackup(db, dataDir, label)
    reply.code(201)
    return manifest
  })

  app.get('/api/v1/backups', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    return { backups: listBackups(dataDir) }
  })

  app.post<{ Params: { id: string } }>('/api/v1/backups/:id/restore', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      const { revision, event, databaseLineage, writerEpoch } = restoreBackup(db, dataDir, req.params.id)
      eventSink.emit(event)
      return { revision, event, databaseLineage, writerEpoch }
    } catch (err) {
      if (err instanceof EntityNotFoundError) {
        reply.code(404)
        return { error: err.message }
      }
      throw err
    }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/backups/:id', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      deleteBackup(dataDir, req.params.id)
      return { id: req.params.id }
    } catch (err) {
      if (err instanceof EntityNotFoundError) {
        reply.code(404)
        return { error: err.message }
      }
      throw err
    }
  })
}
