import type { AlternateGreetingMutation, ChatGreetingIndex } from './alternateGreetingMutation'
import {
  mutateAlternateGreetingsCommand,
  runServerCommand,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from './server/commands'
import { dispatchDurableMutation, registerDurableMutationSettlementListener } from './server/durableMutationDispatch'
import { stagePendingMutation, type DurableMutationIntent } from './server/pendingMutationOutbox'
import { characterOwnerMutationKey } from './server/resourceOwnerMutationKeys'

export type AlternateGreetingPersistenceStatus = 'accepted' | 'queued' | 'failed'

export interface DurableAlternateGreetingMutationInput {
  characterId: string
  alternateGreetings: string[]
  operation: AlternateGreetingMutation
  chatGreetingIndices: ChatGreetingIndex[]
  applyOptimistic: () => void
  rollback: () => void
  onFinalSettlement?: (settlement: 'accepted' | 'discarded') => void
}

/**
 * Stage the character-wide greeting cascade before exposing its optimistic
 * projection, then retain retryable failures for ordered outbox replay.
 */
export async function dispatchDurableAlternateGreetingMutation(
  input: DurableAlternateGreetingMutationInput,
): Promise<AlternateGreetingPersistenceStatus> {
  const alternateGreetings = cloneJsonValue(input.alternateGreetings)
  const operation = cloneJsonValue(input.operation)
  const chatGreetingIndices = cloneJsonValue(input.chatGreetingIndices)
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'PATCH',
        path: `/characters/${encodeURIComponent(input.characterId)}/alternate-greetings`,
        body: freezeJsonValue({ alternateGreetings, operation }),
      },
    ],
  }

  let outbox
  try {
    outbox = stagePendingMutation(characterOwnerMutationKey(input.characterId), intent)
  } catch (error) {
    console.error('Unable to stage alternate greeting mutation:', error)
    return 'failed'
  }

  let settlementCleanup = () => {}
  settlementCleanup = registerDurableMutationSettlementListener(outbox.mutationId, (settlement) => {
    settlementCleanup()
    if (settlement === 'discarded') input.rollback()
    input.onFinalSettlement?.(settlement)
  })

  input.applyOptimistic()

  let result: ServerCommandResult
  let failureRollbackDisposition: ServerCommandTransportOptions['failureRollbackDisposition']
  try {
    result = await dispatchDurableMutation(outbox, intent, (transport) => {
      failureRollbackDisposition = transport.failureRollbackDisposition
      return runServerCommand({
        command: (baseRevision) =>
          mutateAlternateGreetingsCommand({
            baseRevision,
            characterId: input.characterId,
            alternateGreetings,
            operation,
            chatGreetingIndices,
          }),
        rollback: input.rollback,
        ...transport,
      })
    })
  } catch (error) {
    console.error('Alternate greeting mutation command rejected:', error)
    const disposition = failureRollbackDisposition?.({ status: 'unavailable' }) ?? 'rollback'
    if (disposition === 'retain') return 'queued'
    settlementCleanup()
    return 'failed'
  }

  if (result.status === 'ok') {
    settlementCleanup()
    return 'accepted'
  }
  if (failureRollbackDisposition?.(result) === 'retain') return 'queued'
  settlementCleanup()
  return 'failed'
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function freezeJsonValue<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  for (const child of Object.values(value)) freezeJsonValue(child)
  return Object.freeze(value)
}
