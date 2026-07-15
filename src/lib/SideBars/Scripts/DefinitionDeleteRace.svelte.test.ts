import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deleteRaceMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  sortableCreate: vi.fn(() => ({ destroy: vi.fn() })),
}))

vi.mock('src/lang', () => ({
  language: { removeConfirm: 'Remove ' },
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: deleteRaceMocks.alertConfirm,
}))

vi.mock('sortablejs', () => ({
  default: { create: deleteRaceMocks.sortableCreate },
}))

import DefinitionDeleteRaceHarness from './DefinitionDeleteRace.testHarness.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

async function verifyStableDelete(kind: 'regex' | 'trigger', selector: string, expectedRemainingId: string) {
  const confirmation = deferred<boolean>()
  deleteRaceMocks.alertConfirm.mockReturnValue(confirmation.promise)
  component = mount(DefinitionDeleteRaceHarness, { target, props: { kind } })
  await tick()

  target.querySelector<HTMLButtonElement>(selector)?.click()
  await tick()
  expect(deleteRaceMocks.alertConfirm).toHaveBeenCalledWith('Remove A')

  target.querySelector<HTMLButtonElement>('[data-testid="reorder"]')?.click()
  await tick()
  expect(target.querySelector('[data-testid="ids"]')?.textContent).toBe(
    kind === 'regex' ? 'script-b,script-a' : 'trigger-b,trigger-a',
  )

  confirmation.resolve(true)
  await tick()
  await Promise.resolve()

  expect(target.querySelector('[data-testid="ids"]')?.textContent).toBe(expectedRemainingId)
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  deleteRaceMocks.alertConfirm.mockReset()
  deleteRaceMocks.sortableCreate.mockClear()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('definition row deletion', () => {
  it('deletes the confirmed regex script by id after an authoritative reorder', async () => {
    await verifyStableDelete('regex', '[data-risu-regex-action="delete"]', 'script-b')
  })

  it('deletes the confirmed V1 trigger by id after an authoritative reorder', async () => {
    await verifyStableDelete('trigger', '[data-risu-trigger-v1-action="delete"]', 'trigger-b')
  })

  it('does not delete another regex script when the confirmed target vanished', async () => {
    const confirmation = deferred<boolean>()
    deleteRaceMocks.alertConfirm.mockReturnValue(confirmation.promise)
    component = mount(DefinitionDeleteRaceHarness, { target, props: { kind: 'regex' } })
    await tick()

    target.querySelector<HTMLButtonElement>('[data-risu-regex-action="delete"]')?.click()
    await tick()
    expect(deleteRaceMocks.alertConfirm).toHaveBeenCalledWith('Remove A')

    target.querySelector<HTMLButtonElement>('[data-testid="remove-target"]')?.click()
    await tick()
    expect(target.querySelector('[data-testid="ids"]')?.textContent).toBe('script-b')

    confirmation.resolve(true)
    await tick()
    await Promise.resolve()

    expect(target.querySelector('[data-testid="ids"]')?.textContent).toBe('script-b')
  })
})
