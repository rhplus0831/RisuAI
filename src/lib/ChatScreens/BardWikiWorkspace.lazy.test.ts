import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('BardWiki workspace loading boundary', () => {
  it('keeps the workspace behind the active-chat lazy modal', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/ChatScreens/ChatScreen.svelte'), 'utf8')

    expect(source).toContain("const loadBardWikiWorkspace = () => import('./BardWikiWorkspace.svelte')")
    expect(source).not.toMatch(/import\s+BardWikiWorkspace\s+from/)
    expect(source).toContain('testId="bardwiki-workspace"')
  })
})
