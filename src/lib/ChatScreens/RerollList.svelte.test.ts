import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveChatTarget } from 'src/ts/chatCommands'

const rerollListMocks = vi.hoisted(() => ({
  getRerollCandidates: vi.fn((_target?: ActiveChatTarget | null) => [
    {
      index: 0,
      active: false,
      messages: [{ data: 'candidate text', role: 'char', chatId: 'candidate-message' }],
    },
  ]),
}))

vi.mock('src/ts/process/rerollNavigation.svelte', () => ({
  getRerollCandidates: rerollListMocks.getRerollCandidates,
}))

vi.mock('src/lang', () => ({
  language: new Proxy(
    {},
    {
      get: (_target, property) => String(property),
    },
  ),
}))

import RerollList from './RerollList.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | null = null

beforeEach(() => {
  rerollListMocks.getRerollCandidates.mockReset()
  rerollListMocks.getRerollCandidates.mockReturnValue([
    {
      index: 0,
      active: false,
      messages: [{ data: 'candidate text', role: 'char', chatId: 'candidate-message' }],
    },
  ])
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = null
  }
  target.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('RerollList', () => {
  it('renders candidates only from the supplied chat target', async () => {
    const targetA: ActiveChatTarget = {
      selectedCharID: 0,
      chatPage: 0,
      characterId: 'character-a',
      chatId: 'chat-a',
    }
    const targetB: ActiveChatTarget = {
      selectedCharID: 0,
      chatPage: 1,
      characterId: 'character-a',
      chatId: 'chat-b',
    }
    rerollListMocks.getRerollCandidates.mockImplementation((owner) => [
      {
        index: 0,
        active: true,
        messages: [
          {
            data: owner?.chatId === targetA.chatId ? 'Chat A candidate' : 'Chat B candidate',
            role: 'char',
            chatId: `${owner?.chatId}-message`,
          },
        ],
      },
    ])

    component = mount(RerollList, {
      target,
      props: { currentMessage: 'active A', target: targetA },
    }) as MountedComponent
    await tick()
    expect(target.textContent).toContain('Chat A candidate')
    expect(target.textContent).not.toContain('Chat B candidate')
    expect(rerollListMocks.getRerollCandidates).toHaveBeenCalledWith(targetA)

    unmount(component)
    component = mount(RerollList, {
      target,
      props: { currentMessage: 'active B', target: targetB },
    }) as MountedComponent
    await tick()
    expect(target.textContent).toContain('Chat B candidate')
    expect(target.textContent).not.toContain('Chat A candidate')
    expect(rerollListMocks.getRerollCandidates).toHaveBeenLastCalledWith(targetB)
  })

  it('announces which response candidate is active', async () => {
    rerollListMocks.getRerollCandidates.mockReturnValueOnce([
      {
        index: 0,
        active: true,
        messages: [{ data: 'active text', role: 'char', chatId: 'active-message' }],
      },
      {
        index: 1,
        active: false,
        messages: [{ data: 'other text', role: 'char', chatId: 'other-message' }],
      },
    ])
    component = mount(RerollList, {
      target,
      props: {
        currentMessage: 'active text',
        onSelectRerollCandidate: vi.fn(),
        onNewReroll: vi.fn(),
      },
    }) as MountedComponent
    await tick()

    const candidates = target.querySelectorAll<HTMLButtonElement>('.reroll-candidate')
    expect(Array.from(candidates, (candidate) => candidate.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  })

  it('does not fire candidate or new-reroll actions while disabled', async () => {
    const onSelectRerollCandidate = vi.fn()
    const onNewReroll = vi.fn()
    component = mount(RerollList, {
      target,
      props: {
        currentMessage: 'current text',
        disabled: true,
        onSelectRerollCandidate,
        onNewReroll,
      },
    }) as MountedComponent
    await tick()

    const candidate = target.querySelector<HTMLButtonElement>('.reroll-candidate')
    const newReroll = target.querySelector<HTMLButtonElement>('.button-icon-new-reroll')
    expect(candidate?.disabled).toBe(true)
    expect(newReroll?.disabled).toBe(true)

    candidate?.click()
    newReroll?.click()
    await tick()

    expect(onSelectRerollCandidate).not.toHaveBeenCalled()
    expect(onNewReroll).not.toHaveBeenCalled()
  })
})
