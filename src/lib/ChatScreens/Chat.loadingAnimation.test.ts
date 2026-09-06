import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/lib/ChatScreens/Chat.svelte'), 'utf8')

function declarationsFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  expect(match, `missing CSS rule for ${selector}`).toBeTruthy()
  return match?.[1] ?? ''
}

describe('chat generation loading animation', () => {
  it('keeps the white highlight locked to the traveling colored fill', () => {
    expect(declarationsFor('.chat-generation-loading-fill')).toContain(
      'animation: chat-generation-loading-travel 1.3s ease-in-out infinite',
    )

    const highlightDeclarations = declarationsFor('.chat-generation-loading-fill::after')
    expect(highlightDeclarations).not.toMatch(/\b(?:animation|transform)\s*:/)
    expect(source).not.toContain('@keyframes chat-generation-loading-shine')
  })
})
