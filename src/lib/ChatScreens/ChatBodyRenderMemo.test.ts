import { describe, expect, it, vi } from 'vitest'
import { createChatBodyRenderMemo } from './ChatBodyRenderMemo'

describe('finalized chat HTML memo', () => {
  it('reuses settled and pending bodies, while content, metadata and policy changes miss', () => {
    const finalize = vi.fn((html: string, model: string) => `${html}:${model}`)
    const render = createChatBodyRenderMemo(finalize)
    expect(render('body', 'model-a', 'visible')).toBe('body:model-a')
    render('', 'model-a', 'visible')
    expect(render('body', 'model-a', 'visible')).toBe('body:model-a')
    expect(finalize).toHaveBeenCalledTimes(2)
    render('body', 'model-a', 'hidden')
    render('body', 'model-b', 'hidden')
    render('edited', 'model-b', 'hidden')
    expect(finalize).toHaveBeenCalledTimes(5)
  })

  it('evicts old bodies and does not retain oversized results', () => {
    const finalize = vi.fn((html: string) => html)
    const render = createChatBodyRenderMemo(finalize)
    for (const html of ['first', 'second', 'third', 'first']) render(html, '', '')
    expect(finalize).toHaveBeenCalledTimes(4)
    const large = 'a'.repeat(300_000)
    render(large, '', '')
    render(large, '', '')
    expect(finalize).toHaveBeenCalledTimes(6)
  })
})
