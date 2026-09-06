import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Button from './Button.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

describe('Button', () => {
  let component: MountedComponent | undefined
  let form: HTMLFormElement

  beforeEach(() => {
    form = document.createElement('form')
    document.body.appendChild(form)
  })

  afterEach(() => {
    if (component) unmount(component)
    component = undefined
    form.remove()
  })

  it('never submits an ancestor form for a generic action', () => {
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault())
    const click = vi.fn()
    form.addEventListener('submit', submit)
    component = mount(Button, { target: form, props: { onclick: click } })

    const button = form.querySelector('button')
    expect(button?.type).toBe('button')
    button?.click()

    expect(submit).not.toHaveBeenCalled()
  })
})
