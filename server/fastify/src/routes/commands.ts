import type { FastifyInstance, FastifyReply } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { COMMAND_EVENT_CATALOG, type CommandEventSink } from '../commands/events.js'
import { applyJsonCommandMutation, readBaseRevision } from '../commands/mutations.js'
import { requireAuth } from '../http.js'
import { RevisionMismatchError, ValidationError } from '../repository.js'

interface RuntimeSettingsCommandBody {
  baseRevision?: unknown
  patch?: unknown
}

const RUNTIME_SETTING_KEYS = new Set(['useServerPromptAssembly'])

export function registerCommandRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
): void {
  app.patch('/api/v1/commands/settings/runtime', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as RuntimeSettingsCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readRuntimeSettingsPatch(body.patch)
      const result = applyJsonCommandMutation({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutate(database) {
          applyRuntimeSettingsPatch(database, patch)
          return {
            event: COMMAND_EVENT_CATALOG.settingsUpdated,
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })
}

function readRuntimeSettingsPatch(patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('patch must be an object')
  }

  const entries = Object.entries(patch as Record<string, unknown>)
  if (entries.length === 0) {
    throw new ValidationError('patch must include at least one setting')
  }

  for (const [key, value] of entries) {
    if (!RUNTIME_SETTING_KEYS.has(key)) {
      throw new ValidationError(`Unsupported runtime setting: ${key}`)
    }
    if (key === 'useServerPromptAssembly' && typeof value !== 'boolean') {
      throw new ValidationError('useServerPromptAssembly must be a boolean')
    }
  }

  return patch as Record<string, unknown>
}

function applyRuntimeSettingsPatch(database: unknown, patch: Record<string, unknown>): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) {
    throw new ValidationError('database must be an object before settings commands can run')
  }

  const target = database as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    target[key] = value
  }
}

function sendCommandError(
  reply: FastifyReply,
  err: unknown,
): { error: string; currentRevision?: number } {
  if (err instanceof RevisionMismatchError) {
    reply.code(409)
    return { error: 'revision_conflict', currentRevision: err.currentRevision }
  }
  if (err instanceof ValidationError) {
    reply.code(400)
    return { error: err.message }
  }
  throw err
}
