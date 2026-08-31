import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve('src/lib/ChatScreens/ChatScreen.svelte'), 'utf8')

describe('ChatScreen selected character ownership', () => {
  it('fails closed for owner errors and retains only the idle/loading aggregate fallback', () => {
    expect(source).toContain("if (resourceStatus === 'ready') return owner")
    expect(source).toContain("if (resourceStatus === 'idle' || resourceStatus === 'loading') return aggregate")
    expect(source).toContain('return undefined')
    expect(source).toContain('resolveSelectedCharacterForDisplay(')
    expect(source).toContain('const status = charactersResourceState.status')
    expect(source).not.toMatch(/getSelectedCharacterOwner\(\)\s*\?\?\s*getDatabase\(\)\.characters/u)
  })

  it('reads display settings and selected chat validity through explicit owners', () => {
    expect(source).toContain('settingsResourceState.groupStatuses.display')
    expect(source).toContain('getChatMetadataOwnerState(chatId)')
    expect(source).not.toContain('getDatabase().theme')
    expect(source).not.toContain('getDatabase().customBackground')
    expect(source).not.toContain('getDatabase().waifuWidth')
    expect(source).not.toContain('getDatabase().classicMaxWidth')
  })
})
