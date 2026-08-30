import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertProtocolDurableCommandOperationCatalog,
  findProtocolDurableCommandOperation,
  PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG,
  PROTOCOL_DURABLE_COMMAND_ROUTE_OPERATION_ID,
  PROTOCOL_DURABLE_GENERATION_OPERATION_CATALOG,
  protocolDurableGenerationOperationMatches,
} from '@risuai/protocol/durable-command-operation'

const OPENING_ALLOWLIST_SHA256 = '388b54057be8704bbde7bf38460fa18f7fb8a54f13c795127d57ceb5f99c0084'

describe('durable-command operation catalog', () => {
  it('preserves all 129 opening method/path patterns behind unique stable identifiers', () => {
    expect(PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG).toHaveLength(129)
    expect(new Set(PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG.map(({ id }) => id)).size).toBe(129)

    const matcherFingerprint = PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG.map(
      ({ method, path }) => `${method}:${path.source}`,
    ).join('\n')
    expect(createHash('sha256').update(matcherFingerprint).digest('hex')).toBe(OPENING_ALLOWLIST_SHA256)
  })

  it('resolves every reviewed example to exactly its stable operation', () => {
    for (const operation of PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG) {
      expect(findProtocolDurableCommandOperation(operation.method, operation.examplePath), operation.id).toBe(operation)
      expect(operation).not.toHaveProperty('auth')
      expect(operation).not.toHaveProperty('activeWriter')
      expect(operation).not.toHaveProperty('storage')
      expect(operation).not.toHaveProperty('retry')
    }
    expect(PROTOCOL_DURABLE_COMMAND_ROUTE_OPERATION_ID).toBe('commands')
  })

  it.each([
    ['POST', '/messages/translate'],
    ['POST', '/characters/character-a/scripts/reorder'],
    ['PATCH', '/agents/reorder'],
    ['DELETE', '/agent-presets/preset-a/uses/reorder'],
    ['POST', '/prompt-items/item-a'],
    ['POST', '/model-profiles/profile-a'],
    ['PATCH', '/characters/character-a/alternate-greetings/extra'],
    ['DELETE', '/lorebooks/lorebook-a/entries'],
    ['PUT', '/characters/character-a/lorebooks/entries'],
    ['POST', '/chats/chat-a/lorebooks/entries/reorder/extra'],
  ] as const)('rejects the adversarial near miss %s %s', (method, path) => {
    expect(findProtocolDurableCommandOperation(method, path)).toBeUndefined()
  })

  it('relates durable generation intents to the existing shared route operation identifiers', () => {
    expect(PROTOCOL_DURABLE_GENERATION_OPERATION_CATALOG).toMatchObject({
      'generation-operation-submit': { routeOperationId: 'generation-operation-submit' },
      'generation-operation-cancel': { routeOperationId: 'generation-operation-cancel' },
      'generation-operation-retry': { routeOperationId: 'generation-operation-retry' },
    })
    expect(
      protocolDurableGenerationOperationMatches('generation-operation-submit', 'POST', '/generation-operations'),
    ).toBe(true)
    expect(
      protocolDurableGenerationOperationMatches(
        'generation-operation-cancel',
        'PUT',
        '/generation-operations/operation-a/cancellation',
      ),
    ).toBe(true)
    expect(
      protocolDurableGenerationOperationMatches(
        'generation-operation-retry',
        'POST',
        '/generation-operations/operation-a/retries',
      ),
    ).toBe(true)
    expect(
      protocolDurableGenerationOperationMatches('generation-operation-submit', 'PUT', '/generation-operations'),
    ).toBe(false)
    expect(
      protocolDurableGenerationOperationMatches(
        'generation-operation-cancel',
        'PUT',
        '/generation-operations/operation-a/cancellation/extra',
      ),
    ).toBe(false)
    expect(
      protocolDurableGenerationOperationMatches(
        'generation-operation-retry',
        'POST',
        '/generation-operations/operation-a?unsafe/retries',
      ),
    ).toBe(false)
  })

  it('fails closed for duplicate identifiers, duplicate matchers, unanchored patterns, and ambiguous examples', () => {
    expect(() =>
      assertProtocolDurableCommandOperationCatalog([
        { id: 'duplicate', method: 'POST', path: /^\/one$/, examplePath: '/one' },
        { id: 'duplicate', method: 'POST', path: /^\/two$/, examplePath: '/two' },
      ]),
    ).toThrow('Duplicate durable command operation id')

    expect(() =>
      assertProtocolDurableCommandOperationCatalog([
        { id: 'one', method: 'POST', path: /^\/one$/, examplePath: '/one' },
        { id: 'two', method: 'POST', path: /^\/one$/, examplePath: '/one' },
      ]),
    ).toThrow('Duplicate durable command operation matcher')

    expect(() =>
      assertProtocolDurableCommandOperationCatalog([
        { id: 'unanchored', method: 'POST', path: /\/one/, examplePath: '/one' },
      ]),
    ).toThrow('must use an anchored, flag-free matcher')

    expect(() =>
      assertProtocolDurableCommandOperationCatalog([
        { id: 'broad', method: 'POST', path: /^\/items\/[^/]+$/, examplePath: '/items/item-a' },
        { id: 'specific', method: 'POST', path: /^\/items\/item-a$/, examplePath: '/items/item-a' },
      ]),
    ).toThrow('Ambiguous durable command operation example')
  })
})
