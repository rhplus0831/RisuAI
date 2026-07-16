import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { language } from 'src/lang'
import TagManagerModalTestHost from './tag-manager-modal.testHost.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('Hypa V3 tag manager', () => {
  it('does not rename a tag to an existing tag', async () => {
    const onSummaryChanged = vi.fn()
    component = mount(TagManagerModalTestHost, {
      target,
      props: {
        onSummaryChanged,
      },
    })
    await tick()

    const editButtons = target.querySelectorAll<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.editTagAction}"]`,
    )
    editButtons[1]?.click()
    await tick()

    const input = target.querySelector<HTMLInputElement>(`input[aria-label="${language.hypaV3Modal.tagNameLabel}"]`)
    if (!input) throw new Error('Tag edit input not found')
    input.value = ' foo '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.hypaV3Modal.saveTagAction}"]`)?.click()
    await tick()

    expect((component as unknown as { getTags: () => string[] }).getTags()).toEqual(['foo', 'bar'])
    expect(onSummaryChanged).not.toHaveBeenCalled()
    expect(target.querySelector(`input[aria-label="${language.hypaV3Modal.tagNameLabel}"]`)).not.toBeNull()
  })
})
