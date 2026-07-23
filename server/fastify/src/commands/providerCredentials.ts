import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import { normalizeModelProfiles } from '../../../../src/ts/model/modelProfileRecords.js'
import {
  ProviderCredentialRecordValidationError,
  readProviderCredentials,
  type ProviderCredentialRecord,
} from '../../../../src/ts/model/providerCredentialRecords.js'
import { isMaskedProviderSecret } from '../../../../src/ts/providerSecretMask.js'
import { resolveMaskedProviderSecretPlaceholders } from '../providerSecrets.js'
import {
  EntityNotFoundError,
  extractSettings,
  RevisionMismatchError,
  ValidationError,
  writeSettingsOnly,
} from '../repository.js'
import {
  applyTargetedCommandMutation,
  TARGETED_MUTATION_PATHS,
  type CommandMutationReceiptKey,
  type JsonCommandMutationResult,
} from './mutations.js'
import { COMMAND_EVENT_CATALOG, type CommandEventOrigin, type CommandEventSink } from './events.js'

interface ProviderCredentialCommandArgs {
  db: DatabaseSync
  dataDir: string
  baseRevision: number
  eventSink: CommandEventSink
  eventOrigin?: CommandEventOrigin
  mutationReceiptKey?: CommandMutationReceiptKey
  body: unknown
}

export function createProviderCredentialCommand(
  args: ProviderCredentialCommandArgs,
): JsonCommandMutationResult<{ credentialId: string }> {
  const body = readObject(args.body, 'request body')
  const requested = readObject(body.credential, 'credential')
  if (Object.prototype.hasOwnProperty.call(requested, 'id')) {
    throw new ValidationError('credential.id is server-generated')
  }

  return applyProviderCredentialMutation(args, (target) => {
    const credentials = currentCredentials(target)
    const credentialId = mintProviderCredentialId(credentials)
    const credential = readCredentialRow({ ...requested, id: credentialId })
    rejectMaskedCredentialSecrets(credential)
    target.providerCredentials = readCredentialRows([...credentials, credential])
    return {
      event: { ...COMMAND_EVENT_CATALOG.providerCredentialCreated, id: credentialId },
      extra: { credentialId },
    }
  })
}

export function updateProviderCredentialCommand(
  args: ProviderCredentialCommandArgs & { credentialId: string },
): JsonCommandMutationResult<{ credentialId: string }> {
  const credentialId = readNonEmptyString(args.credentialId, 'credentialId')
  const body = readObject(args.body, 'request body')
  const requested = readCredentialBody(body.credential, credentialId, 'credential')
  const expected = readCredentialBody(body.expectedCredential, credentialId, 'expectedCredential')

  return applyProviderCredentialMutation(args, (target) => {
    const credentials = currentCredentials(target)
    const index = credentials.findIndex((credential) => credential.id === credentialId)
    if (index < 0) throw new EntityNotFoundError(`Provider credential not found: ${credentialId}`)

    const resolvedRequested = resolveCredentialPlaceholders(target, requested)
    rejectMaskedCredentialSecrets(resolvedRequested)
    const resolvedExpected = resolveCredentialPlaceholders(target, expected)
    if (!isDeepStrictEqual(credentials[index], resolvedExpected)) {
      throw new RevisionMismatchError(
        args.baseRevision,
        `Provider credential changed since editing began: ${credentialId}`,
      )
    }

    const nextCredentials = [...credentials]
    nextCredentials[index] = resolvedRequested
    target.providerCredentials = readCredentialRows(nextCredentials)
    return {
      event: { ...COMMAND_EVENT_CATALOG.providerCredentialUpdated, id: credentialId },
      extra: { credentialId },
    }
  })
}

export function deleteProviderCredentialCommand(
  args: ProviderCredentialCommandArgs & { credentialId: string },
): JsonCommandMutationResult<{ credentialId: string }> {
  const credentialId = readNonEmptyString(args.credentialId, 'credentialId')

  return applyProviderCredentialMutation(args, (target) => {
    const credentials = currentCredentials(target)
    if (!credentials.some((credential) => credential.id === credentialId)) {
      throw new EntityNotFoundError(`Provider credential not found: ${credentialId}`)
    }

    const references = normalizeModelProfiles(target.modelProfiles ?? []).filter(
      (profile) => profile.providerOptions?.credentialId === credentialId,
    )
    if (references.length > 0) {
      const labels = references.map((profile) => `${profile.name} (${profile.id})`).join(', ')
      throw new ValidationError(`Provider credential ${credentialId} is used by model profiles: ${labels}`)
    }

    target.providerCredentials = credentials.filter((credential) => credential.id !== credentialId)
    return {
      event: { ...COMMAND_EVENT_CATALOG.providerCredentialDeleted, id: credentialId },
      extra: { credentialId },
    }
  })
}

function applyProviderCredentialMutation<TExtra extends Record<string, unknown>>(
  args: Omit<ProviderCredentialCommandArgs, 'body'>,
  mutateTarget: (target: Record<string, unknown>) => {
    event: (typeof COMMAND_EVENT_CATALOG)[keyof typeof COMMAND_EVENT_CATALOG] & { id?: string }
    extra: TExtra
  },
): JsonCommandMutationResult<TExtra> {
  return applyTargetedCommandMutation<TExtra>({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision: args.baseRevision,
    eventSink: args.eventSink,
    ...(args.eventOrigin ? { eventOrigin: args.eventOrigin } : {}),
    ...(args.mutationReceiptKey ? { mutationReceiptKey: args.mutationReceiptKey } : {}),
    mutationPath: TARGETED_MUTATION_PATHS.settings,
    settingsScopedRead: true,
    mutate(database, innerDb) {
      if (!isRecord(database)) {
        throw new ValidationError('database must be an object before provider credential commands can run')
      }
      const result = mutateTarget(database)
      writeSettingsOnly(innerDb, extractSettings(database))
      return result
    },
  })
}

function currentCredentials(target: Record<string, unknown>): ProviderCredentialRecord[] {
  return readCredentialRows(target.providerCredentials ?? [])
}

function resolveCredentialPlaceholders(
  source: Record<string, unknown>,
  credential: ProviderCredentialRecord,
): ProviderCredentialRecord {
  const resolved = resolveMaskedProviderSecretPlaceholders(source, {
    providerCredentials: [credential],
  })
  return readCredentialRows(resolved.providerCredentials)[0]
}

function readCredentialBody(value: unknown, credentialId: string, path: string): ProviderCredentialRecord {
  const credential = readObject(value, path)
  if (Object.prototype.hasOwnProperty.call(credential, 'id') && credential.id !== credentialId) {
    throw new ValidationError(`${path}.id must match credentialId`)
  }
  return readCredentialRow({ ...credential, id: credentialId })
}

function readCredentialRow(value: unknown): ProviderCredentialRecord {
  return readCredentialRows([value])[0]
}

function readCredentialRows(value: unknown): ProviderCredentialRecord[] {
  try {
    return readProviderCredentials(value)
  } catch (error) {
    if (error instanceof ProviderCredentialRecordValidationError) {
      throw new ValidationError(error.message)
    }
    throw error
  }
}

function rejectMaskedCredentialSecrets(credential: ProviderCredentialRecord): void {
  if (isMaskedProviderSecret(credential.apiKey) || isMaskedProviderSecret(credential.vertex?.privateKey)) {
    throw new ValidationError('Masked provider secret placeholders must resolve before a credential can be saved')
  }
}

function mintProviderCredentialId(credentials: readonly ProviderCredentialRecord[]): string {
  const existingIds = new Set(credentials.map((credential) => credential.id))
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `cred_${randomUUID().replaceAll('-', '').slice(0, 20)}`
    if (!existingIds.has(id)) return id
  }
  throw new Error('Unable to mint a unique provider credential id')
}

function readObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError(`${path} must be an object`)
  return value
}

function readNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${path} must be a non-empty string`)
  }
  return value.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
