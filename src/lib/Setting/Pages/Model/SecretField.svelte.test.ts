import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { language } from 'src/lang'
import SecretFieldTestHost from './SecretField.testHost.svelte'
import type { ModelProfileSecretDraft } from 'src/ts/model/modelProfileSecrets'

type MountedComponent = Parameters<typeof unmount>[0]
type SecretFieldTestHostExports = { currentValue: () => ModelProfileSecretDraft }

let host: SecretFieldTestHostExports
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  host = mount(SecretFieldTestHost, { target }) as unknown as SecretFieldTestHostExports
})

afterEach(() => {
  unmount(host as unknown as MountedComponent)
  target.remove()
})

describe('SecretField saved credentials', () => {
  it('provides an explicit localized clear action', async () => {
    const input = target.querySelector<HTMLInputElement>('input[type="password"]')
    const clear = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.secretInput.clearSaved}"]`)

    expect(input?.value).toBe('')
    expect(clear).toBeTruthy()
    expect(host.currentValue().disposition).toBe('preserve')

    clear!.click()
    await tick()

    expect(host.currentValue()).toMatchObject({ disposition: 'clear', hasExistingSecret: true, value: '' })
    expect(target.querySelector('[data-secret-saved-state]')).toBeNull()
  })

  it('switches from preserve to replace when a new credential is entered', async () => {
    const input = target.querySelector<HTMLInputElement>('input[type="password"]')
    if (!input) throw new Error('secret input not found')
    input.value = 'new-credential'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    await tick()

    expect(host.currentValue()).toMatchObject({ disposition: 'replace', value: 'new-credential' })
  })
})
