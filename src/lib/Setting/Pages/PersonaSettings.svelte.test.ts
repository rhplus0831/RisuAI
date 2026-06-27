import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('PersonaSettings persistence contracts', () => {
  it('flushes pending selected-persona edits when the page is destroyed', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/PersonaSettings.svelte'), 'utf8')

    expect(source).toContain('flushPendingSelectedPersonaUpdate')
    expect(source).toMatch(/onDestroy\(\(\) => \{\s*void flushPendingSelectedPersonaUpdate\(\)/)
  })

  it('keeps persona notes visible as a multiline field', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/PersonaSettings.svelte'), 'utf8')

    expect(source).toContain('{language.personaNote}')
    expect(source).not.toContain('DBState.db.personaNote')
    expect(source).toMatch(/<TextAreaInput[\s\S]*bind:value=\{\(\) => DBState\.db\.userNote,/)
  })

  it('exposes display name as a persona row field', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/PersonaSettings.svelte'), 'utf8')

    expect(source).toContain('{language.displayName}')
    expect(source).toContain('updateSelectedPersonaDisplayName')
    expect(source).toContain('DBState.db.personas[DBState.db.selectedPersona]?.displayName')
  })

  it('reconciles projection epoch changes before queuing normal selected-persona edits', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/PersonaSettings.svelte'), 'utf8')
    const projectionBranch = source.match(/if \(projectionApplyChanged\) \{[\s\S]*?\n    \}/)?.[0] ?? ''

    expect(source).toContain('getServerProjectionApplyEpoch')
    expect(source).toContain('reconcileSelectedPersonaProjectionEpoch')
    expect(projectionBranch).toContain('untrack(() => reconcileSelectedPersonaProjectionEpoch())')
    expect(projectionBranch).toContain(
      'previousPersonaSnapshot = snapshotPersonaJson(currentSelectedPersonaProjectionSnapshot())',
    )
    expect(projectionBranch).toContain('previousPersonaState = currentPersonaStateSnapshot()')
    expect(projectionBranch).toMatch(/return\s*\n\s*\}$/)
    expect(source.indexOf('if (projectionApplyChanged)')).toBeLessThan(
      source.indexOf('untrack(() => queueSelectedPersonaUpdate(previous, attempted))'),
    )
  })
})
