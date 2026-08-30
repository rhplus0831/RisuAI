import { describe, expect, it } from 'vitest'
import { AGENT_ONLY_LOREBOOK_EXTENSION_KEY, isAgentOnlyLorebookEntry } from './agentOnlyLorebook.js'

describe('agent-only lorebook predicate', () => {
  it('keeps the portable extension key stable', () => {
    expect(AGENT_ONLY_LOREBOOK_EXTENSION_KEY).toBe('risu_agent_only')
  })

  it('rejects nullish and unmarked entries', () => {
    expect(isAgentOnlyLorebookEntry(null)).toBe(false)
    expect(isAgentOnlyLorebookEntry(undefined)).toBe(false)
    expect(isAgentOnlyLorebookEntry({})).toBe(false)
    expect(isAgentOnlyLorebookEntry({ extentions: {} })).toBe(false)
  })

  it('accepts the direct marker only when it is exactly true', () => {
    expect(isAgentOnlyLorebookEntry({ agentOnly: true })).toBe(true)
    expect(isAgentOnlyLorebookEntry({ agentOnly: false })).toBe(false)
    expect(isAgentOnlyLorebookEntry({ agentOnly: 1 })).toBe(false)
    expect(isAgentOnlyLorebookEntry({ agentOnly: 'true' })).toBe(false)
  })

  it('accepts the extension marker only when it is exactly true', () => {
    expect(isAgentOnlyLorebookEntry({ extentions: { risu_agent_only: true } })).toBe(true)
    expect(isAgentOnlyLorebookEntry({ extentions: { risu_agent_only: false } })).toBe(false)
    expect(isAgentOnlyLorebookEntry({ extentions: { risu_agent_only: 1 } })).toBe(false)
    expect(isAgentOnlyLorebookEntry({ extentions: { risu_agent_only: 'true' } })).toBe(false)
  })

  it('falls back to the extension when the direct marker is false', () => {
    expect(
      isAgentOnlyLorebookEntry({
        agentOnly: false,
        extentions: { risu_agent_only: true },
      }),
    ).toBe(true)
  })

  it('does not mutate the inspected entry', () => {
    const entry = { agentOnly: false, extentions: { risu_agent_only: true, untouched: 'value' } }
    const before = structuredClone(entry)

    isAgentOnlyLorebookEntry(entry)

    expect(entry).toEqual(before)
  })
})
