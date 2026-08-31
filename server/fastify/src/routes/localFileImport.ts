import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { ActiveWriterState } from '../activeWriter.js'
import { readActiveWriterSessionId, requireActiveWriter } from '../activeWriter.js'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import type { CommandEventOrigin, CommandEventSink } from '../commands/events.js'
import { COMMAND_EVENT_CATALOG } from '../commands/events.js'
import { TARGETED_MUTATION_PATHS, applyTargetedCommandMutation } from '../commands/mutations.js'
import { createModuleRecord, readStrictModuleRecords, validateStoredModuleRecord } from '../commands/modules.js'
import { RevisionMismatchError, ValidationError, writeSingleCollectionTable } from '../repository.js'
import { readJsonObject } from '../commands/characters.js'
import {
  CharacterPasswordInvalidError,
  CharacterPasswordRequiredError,
  importLocalCharacterFile,
  importLocalModuleFile,
} from '../localFileImport.js'
import { LowLevelAccessImportError } from '../realmImport/characterCard.js'
import { appendRealmCharacter } from './realmImport.js'
import { importRateLimit } from '../routeRateLimits.js'

type ImportKind = 'character' | 'module'

interface ImportQuery {
  baseRevision?: unknown
}

interface PendingImportBody {
  baseRevision?: unknown
  pendingImportToken?: unknown
  allowLowLevelAccess?: unknown
  password?: unknown
}

interface PendingLocalFileImport {
  kind: ImportKind
  fileName: string
  filePath: string
  tempDir: string
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_PENDING_IMPORT_TTL_MS = 10 * 60_000

export function registerLocalFileImportRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
  activeWriterState: ActiveWriterState,
  options: {
    maxUploadBytes: number
    maxExpandedBytes?: number
    pendingImportTtlMs?: number
  },
): void {
  const pendingImports = new Map<string, PendingLocalFileImport>()
  const ttlMs = options.pendingImportTtlMs ?? DEFAULT_PENDING_IMPORT_TTL_MS

  app.addHook('onClose', async () => {
    const pending = [...pendingImports.values()]
    pendingImports.clear()
    await Promise.all(
      pending.map(async (entry) => {
        clearTimeout(entry.timer)
        await fs.promises.rm(entry.tempDir, { recursive: true, force: true }).catch(() => {})
      }),
    )
  })

  const requireImportAccess = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(authState, req, reply))) return
    requireActiveWriter(activeWriterState, req, reply)
  }

  app.post(
    '/api/v1/import/character-card',
    { config: { rateLimit: importRateLimit }, onRequest: requireImportAccess },
    async (req, reply) =>
      handleLocalFileImport({
        kind: 'character',
        req,
        reply,
        db,
        dataDir,
        eventSink,
        pendingImports,
        ttlMs,
        options,
      }),
  )

  app.post(
    '/api/v1/import/module',
    { config: { rateLimit: importRateLimit }, onRequest: requireImportAccess },
    async (req, reply) =>
      handleLocalFileImport({
        kind: 'module',
        req,
        reply,
        db,
        dataDir,
        eventSink,
        pendingImports,
        ttlMs,
        options,
      }),
  )
}

async function handleLocalFileImport(args: {
  kind: ImportKind
  req: FastifyRequest
  reply: FastifyReply
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  pendingImports: Map<string, PendingLocalFileImport>
  ttlMs: number
  options: { maxUploadBytes: number; maxExpandedBytes?: number }
}): Promise<unknown> {
  let pending: PendingLocalFileImport | null = null
  let ownsUpload = false
  try {
    const retry = args.req.isMultipart() ? null : readPendingImportBody(args.req.body)
    const baseRevision = args.req.isMultipart()
      ? readBaseRevisionQuery((args.req.query ?? {}) as ImportQuery)
      : readBaseRevision(retry?.baseRevision)
    let allowLowLevelAccess = retry?.allowLowLevelAccess === true
    const password = typeof retry?.password === 'string' ? retry.password : undefined

    if (retry) {
      pending = takePendingImport(args.pendingImports, retry.pendingImportToken, args.kind, false)
    } else {
      pending = await receivePendingImport(args.req, args.kind, args.options.maxUploadBytes, args.ttlMs)
      ownsUpload = true
    }

    const eventOrigin = commandEventOrigin(args.req)
    if (args.kind === 'character') {
      const imported = await importLocalCharacterFile({
        db: args.db,
        dataDir: args.dataDir,
        filePath: pending.filePath,
        fileName: pending.fileName,
        allowLowLevelAccess,
        password,
        maxExpandedBytes: args.options.maxExpandedBytes,
      })
      const result = appendRealmCharacter({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        eventOrigin,
        baseRevision,
        character: imported.character,
      })
      consumePendingImport(args.pendingImports, pending)
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
        importReport: imported.report,
      }
    }

    const imported = await importLocalModuleFile({
      db: args.db,
      dataDir: args.dataDir,
      filePath: pending.filePath,
      fileName: pending.fileName,
      allowLowLevelAccess,
      maxExpandedBytes: args.options.maxExpandedBytes,
    })
    const module = createModuleRecord(imported.module, 'module', { allowMcp: true }, { assetDb: args.db })
    const result = applyTargetedCommandMutation<{ moduleId: string }>({
      db: args.db,
      dataDir: args.dataDir,
      baseRevision,
      eventSink: args.eventSink,
      ...(eventOrigin ? { eventOrigin } : {}),
      mutationPath: TARGETED_MUTATION_PATHS.collection,
      collectionScopedRead: ['modules'],
      mutate(database, innerDb) {
        const target = readJsonObject(database, 'database')
        const modules = readStrictModuleRecords(target)
        modules.forEach((candidate, index) =>
          validateStoredModuleRecord(candidate, `module[${index}]`, { allowMcp: true }),
        )
        if (modules.some((candidate) => candidate.id === module.id)) {
          throw new ValidationError(`Module already exists: ${module.id}`)
        }
        modules.push(module)
        writeSingleCollectionTable(innerDb, 'modules', modules)
        return {
          event: { ...COMMAND_EVENT_CATALOG.moduleCreated, id: module.id },
          extra: { moduleId: module.id },
        }
      },
    })
    consumePendingImport(args.pendingImports, pending)
    return { revision: result.revision, event: result.event, ...result.extra }
  } catch (error) {
    if (error instanceof LowLevelAccessImportError && pending) {
      const token = retainPendingImport(args.pendingImports, pending, args.ttlMs)
      args.reply.code(409)
      return {
        error: error.message,
        code: 'low_level_access_confirmation_required',
        pendingImportToken: token,
      }
    }
    if (error instanceof CharacterPasswordRequiredError && pending) {
      const token = retainPendingImport(args.pendingImports, pending, args.ttlMs)
      args.reply.code(409)
      return { error: error.message, code: 'character_password_required', pendingImportToken: token }
    }
    if (error instanceof CharacterPasswordInvalidError) {
      if (pending) retainPendingImport(args.pendingImports, pending, args.ttlMs)
      args.reply.code(400)
      return { error: error.message, code: 'character_password_invalid' }
    }
    if (error instanceof RevisionMismatchError) {
      if (pending) retainPendingImport(args.pendingImports, pending, args.ttlMs)
      args.reply.code(409)
      return { error: error.message, currentRevision: error.currentRevision }
    }
    if (error instanceof ValidationError) {
      if (pending) consumePendingImport(args.pendingImports, pending)
      args.reply.code(400)
      return { error: error.message }
    }
    if (ownsUpload && pending) consumePendingImport(args.pendingImports, pending)
    throw error
  }
}

async function receivePendingImport(
  req: FastifyRequest,
  kind: ImportKind,
  maxUploadBytes: number,
  ttlMs: number,
): Promise<PendingLocalFileImport> {
  if (!req.isMultipart()) throw new ValidationError(`${kind} import requires a multipart file upload`)
  const file = await req.file({ limits: { fileSize: maxUploadBytes } })
  if (!file) throw new ValidationError(`${kind} import file missing`)
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `risu-${kind}-import-`))
  const filePath = path.join(tempDir, 'upload')
  try {
    await pipeline(file.file, fs.createWriteStream(filePath))
    if (file.file.truncated) throw new ValidationError(`${kind} import upload exceeds size limit`)
    if ((await fs.promises.stat(filePath)).size === 0) throw new ValidationError(`${kind} import file is empty`)
    const pending: PendingLocalFileImport = {
      kind,
      fileName: file.filename,
      filePath,
      tempDir,
      expiresAt: Date.now() + ttlMs,
      timer: setTimeout(() => {}, ttlMs),
    }
    pending.timer.unref()
    return pending
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

function retainPendingImport(
  pendingImports: Map<string, PendingLocalFileImport>,
  pending: PendingLocalFileImport,
  ttlMs: number,
): string {
  for (const [existingToken, existing] of pendingImports) {
    if (existing === pending) return existingToken
  }
  clearTimeout(pending.timer)
  const token = randomBytes(24).toString('base64url')
  pending.expiresAt = Date.now() + ttlMs
  pending.timer = setTimeout(() => consumePendingImport(pendingImports, pending), ttlMs)
  pending.timer.unref()
  pendingImports.set(token, pending)
  return token
}

function takePendingImport(
  pendingImports: Map<string, PendingLocalFileImport>,
  tokenValue: unknown,
  kind: ImportKind,
  consume: boolean,
): PendingLocalFileImport {
  if (typeof tokenValue !== 'string' || tokenValue.length === 0) {
    throw new ValidationError('pendingImportToken must be a non-empty string')
  }
  const pending = pendingImports.get(tokenValue)
  if (!pending || pending.kind !== kind || pending.expiresAt <= Date.now()) {
    if (pending) consumePendingImport(pendingImports, pending)
    throw new ValidationError('Pending import token is invalid or expired')
  }
  if (consume) pendingImports.delete(tokenValue)
  return pending
}

function consumePendingImport(
  pendingImports: Map<string, PendingLocalFileImport>,
  pending: PendingLocalFileImport,
): void {
  for (const [token, candidate] of pendingImports) {
    if (candidate === pending) pendingImports.delete(token)
  }
  clearTimeout(pending.timer)
  void fs.promises.rm(pending.tempDir, { recursive: true, force: true })
}

function readPendingImportBody(value: unknown): PendingImportBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('import retry body must be an object')
  }
  const body = value as PendingImportBody
  if (body.allowLowLevelAccess !== undefined && typeof body.allowLowLevelAccess !== 'boolean') {
    throw new ValidationError('allowLowLevelAccess must be a boolean')
  }
  if (body.password !== undefined && typeof body.password !== 'string') {
    throw new ValidationError('password must be a string')
  }
  return body
}

function readBaseRevisionQuery(query: ImportQuery): number {
  const raw = query.baseRevision
  const parsed = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  return readBaseRevision(parsed)
}

function readBaseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ValidationError('baseRevision must be a non-negative integer')
  }
  return value as number
}

function commandEventOrigin(req: FastifyRequest): CommandEventOrigin | undefined {
  const writerSessionId = readActiveWriterSessionId(req)
  return writerSessionId ? { writerSessionId } : undefined
}
