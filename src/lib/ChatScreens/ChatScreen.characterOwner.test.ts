import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve('src/lib/ChatScreens/ChatScreen.svelte'), 'utf8')

describe('ChatScreen selected character ownership', () => {
  it('fails closed after readiness and retains only the pre-ready aggregate fallback', () => {
    expect(source).toContain("return owner ?? (resourceStatus === 'ready' ? undefined : aggregate)")
    expect(source).toContain('resolveSelectedCharacterForDisplay(')
    expect(source).toContain('charactersResourceState.status,')
    expect(source).not.toMatch(/getSelectedCharacterOwner\(\)\s*\?\?\s*getDatabase\(\)\.characters/u)
  })
})
