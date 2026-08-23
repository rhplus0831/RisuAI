import { get, writable } from 'svelte/store'

export type GenerationDisplayMode = 'send' | 'continue' | 'regenerate'
export type GenerationDisplayProjectionStatus = 'preparing' | 'streaming' | 'finalizing' | 'failed'

export interface GenerationDisplayProjectionRef {
  operationId: string
  attemptNo: number
  characterId: string
  chatId: string
  mode: GenerationDisplayMode
  targetMessageId?: string
  generationId?: string
  projectionEpoch: number
}

export interface GenerationDisplayProjection extends GenerationDisplayProjectionRef {
  status: GenerationDisplayProjectionStatus
  text: string | null
  gapTruncated: boolean
}

export const generationDisplayProjections = writable<GenerationDisplayProjection[]>([])
export const generationPresentationAliases = writable<Record<string, string>>({})

const MAX_PRESENTATION_ALIASES = 512

function projectionKey(ref: Pick<GenerationDisplayProjectionRef, 'operationId' | 'attemptNo'>): string {
  return `${ref.operationId}:${ref.attemptNo}`
}

function aliasKey(chatId: string, messageId: string): string {
  return `${chatId}\u0000${messageId}`
}

function targetPresentationKey(ref: GenerationDisplayProjectionRef): string | undefined {
  return ref.targetMessageId
}

function installPresentationAlias(chatId: string, messageId: string, presentationKey: string): void {
  generationPresentationAliases.update((aliases) => {
    const key = aliasKey(chatId, messageId)
    if (aliases[key] === presentationKey) return aliases
    const next = { ...aliases, [key]: presentationKey }
    const keys = Object.keys(next)
    if (keys.length <= MAX_PRESENTATION_ALIASES) return next
    for (const stale of keys.slice(0, keys.length - MAX_PRESENTATION_ALIASES)) delete next[stale]
    return next
  })
}

function sameProjectionAttempt(
  projection: GenerationDisplayProjection,
  ref: Pick<GenerationDisplayProjectionRef, 'operationId' | 'attemptNo'>,
): boolean {
  return projection.operationId === ref.operationId && projection.attemptNo === ref.attemptNo
}

export function beginGenerationDisplayProjection(ref: GenerationDisplayProjectionRef): GenerationDisplayProjection {
  const presentationKey = targetPresentationKey(ref)
  if (presentationKey && ref.targetMessageId) {
    installPresentationAlias(ref.chatId, ref.targetMessageId, presentationKey)
  }
  if (presentationKey && ref.generationId) {
    installPresentationAlias(ref.chatId, ref.generationId, presentationKey)
  }

  let active!: GenerationDisplayProjection
  generationDisplayProjections.update((projections) => {
    const existing = projections.find((projection) => sameProjectionAttempt(projection, ref))
    if (existing) {
      active = existing
      return projections
    }
    active = {
      ...ref,
      status: 'preparing',
      text: null,
      gapTruncated: false,
    }
    return [
      ...projections.filter(
        (projection) =>
          projection.operationId !== ref.operationId &&
          !(
            projection.chatId === ref.chatId &&
            projection.mode === ref.mode &&
            projection.targetMessageId === ref.targetMessageId
          ),
      ),
      active,
    ]
  })
  return active
}

export function updateGenerationDisplayProjection(
  ref: Pick<GenerationDisplayProjectionRef, 'operationId' | 'attemptNo'>,
  update: Partial<
    Pick<GenerationDisplayProjection, 'generationId' | 'status' | 'text' | 'gapTruncated' | 'projectionEpoch'>
  >,
): boolean {
  let updated = false
  let alias: { chatId: string; targetMessageId?: string; generationId?: string } | undefined
  generationDisplayProjections.update((projections) =>
    projections.map((projection) => {
      if (!sameProjectionAttempt(projection, ref)) return projection
      updated = true
      const next = { ...projection, ...update }
      alias = {
        chatId: next.chatId,
        targetMessageId: next.targetMessageId,
        generationId: next.generationId,
      }
      return next
    }),
  )
  if (alias?.targetMessageId && alias.generationId) {
    const presentationKey = alias.targetMessageId
    installPresentationAlias(alias.chatId, alias.targetMessageId, presentationKey)
    installPresentationAlias(alias.chatId, alias.generationId, presentationKey)
  }
  return updated
}

export function finishGenerationDisplayProjection(
  ref: Pick<GenerationDisplayProjectionRef, 'operationId' | 'attemptNo'>,
): void {
  generationDisplayProjections.update((projections) =>
    projections.filter((projection) => !sameProjectionAttempt(projection, ref)),
  )
}

export function findGenerationDisplayProjection(
  ref: Pick<GenerationDisplayProjectionRef, 'operationId' | 'attemptNo'>,
): GenerationDisplayProjection | undefined {
  return get(generationDisplayProjections).find((projection) => sameProjectionAttempt(projection, ref))
}

export function generationDisplayProjectionForMessage(
  projections: readonly GenerationDisplayProjection[],
  chatId: string | null | undefined,
  messageId: string | null | undefined,
): GenerationDisplayProjection | undefined {
  if (!chatId || !messageId) return undefined
  return projections
    .filter(
      (projection) =>
        projection.chatId === chatId &&
        projection.mode === 'regenerate' &&
        (projection.targetMessageId === messageId || projection.generationId === messageId),
    )
    .sort(
      (left, right) =>
        left.projectionEpoch - right.projectionEpoch ||
        left.attemptNo - right.attemptNo ||
        left.operationId.localeCompare(right.operationId),
    )
    .at(-1)
}

export function generationPresentationKey(
  aliases: Readonly<Record<string, string>>,
  chatId: string | null | undefined,
  messageId: string | null | undefined,
  fallback: string,
): string {
  if (!chatId || !messageId) return fallback
  return aliases[aliasKey(chatId, messageId)] ?? fallback
}

export function clearGenerationPresentationAliasesForChat(chatId: string | null | undefined): void {
  if (!chatId) return
  const prefix = `${chatId}\u0000`
  generationPresentationAliases.update((aliases) => {
    const retained = Object.entries(aliases).filter(([key]) => !key.startsWith(prefix))
    return retained.length === Object.keys(aliases).length ? aliases : Object.fromEntries(retained)
  })
}

export function resetGenerationDisplayProjectionsForTests(): void {
  generationDisplayProjections.set([])
  generationPresentationAliases.set({})
}
