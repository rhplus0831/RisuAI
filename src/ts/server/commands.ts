import { isFastifyServer } from '../platform'
import { getNodeServerProxyAuth } from '../storage/nodeStorage'

const COMMAND_ENDPOINT = '/api/v1/commands'
const BOOTSTRAP_ENDPOINT = '/api/v1/bootstrap'

export const SETTINGS_GROUPS = [
  'providers',
  'runtime',
  'display',
  'language',
  'media',
  'memory',
  'advanced',
  'sidebar',
  'account',
] as const

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

export interface CommandEvent {
  type: string
  revision: number
  resource: string
  id?: string
  parentId?: string
}

export type ServerCommandResult<T extends Record<string, unknown> = {}> =
  | ({ status: 'ok'; revision: number; event: CommandEvent } & T)
  | { status: 'conflict'; currentRevision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export type SettingsPatch = Record<string, unknown>

export interface RuntimeSettingsPatch extends SettingsPatch {
  useServerPromptAssembly?: boolean
}

export interface PatchRuntimeSettingsInput {
  baseRevision: number
  patch: RuntimeSettingsPatch
}

export interface PatchSettingsGroupInput {
  group: SettingsGroup
  baseRevision: number
  patch: SettingsPatch
}

let cachedServerCommandRevision: number | null = null

export function canUseServerCommands(): boolean {
  return isFastifyServer
}

export function setCachedServerCommandRevision(revision: number): void {
  if (Number.isInteger(revision) && revision >= 0) {
    cachedServerCommandRevision = revision
  }
}

export function clearCachedServerCommandRevision(): void {
  cachedServerCommandRevision = null
}

export async function getServerCommandBaseRevision(signal?: AbortSignal | null): Promise<number | null> {
  if (!canUseServerCommands()) return null
  if (cachedServerCommandRevision !== null) return cachedServerCommandRevision

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(BOOTSTRAP_ENDPOINT, {
      method: 'GET',
      signal: signal ?? undefined,
      headers: {
        'risu-auth': auth,
      },
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  try {
    const body = (await response.json()) as { revision?: unknown }
    if (Number.isInteger(body.revision) && (body.revision as number) >= 0) {
      cachedServerCommandRevision = body.revision as number
      return cachedServerCommandRevision
    }
  } catch {
    return null
  }

  return null
}

export async function patchRuntimeSettings(
  input: PatchRuntimeSettingsInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return patchSettingsGroup(
    {
      group: 'runtime',
      ...input,
    },
    signal,
  )
}

export async function patchSettingsGroup(
  input: PatchSettingsGroupInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson(`/settings/${encodeURIComponent(input.group)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

async function requestCommandJson<T extends Record<string, unknown> = {}>(
  path: string,
  init: { method: string; body: unknown; signal?: AbortSignal | null },
): Promise<ServerCommandResult<T>> {
  if (!canUseServerCommands()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(`${COMMAND_ENDPOINT}${path}`, {
      method: init.method,
      signal: init.signal ?? undefined,
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
      },
      body: JSON.stringify(init.body),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON command errors are reported by HTTP status below.
  }

  if (response.status === 409) {
    const currentRevision = readCurrentRevision(body)
    if (currentRevision !== null) setCachedServerCommandRevision(currentRevision)
    return currentRevision === null
      ? { status: 'error', error: errorMessageFromBody(body, 'HTTP 409') }
      : { status: 'conflict', currentRevision }
  }

  if (!response.ok) {
    return {
      status: 'error',
      error: errorMessageFromBody(body, `HTTP ${response.status}`),
    }
  }

  if (body && typeof body === 'object') {
    const revision = (body as { revision?: unknown }).revision
    if (Number.isInteger(revision) && (revision as number) >= 0) {
      setCachedServerCommandRevision(revision as number)
    }
  }

  return { status: 'ok', ...(body as { revision: number; event: CommandEvent } & T) }
}

function readCurrentRevision(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const currentRevision = (body as { currentRevision?: unknown }).currentRevision
  return Number.isInteger(currentRevision) ? (currentRevision as number) : null
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.reason === 'string') return record.reason
  }
  return fallback
}
