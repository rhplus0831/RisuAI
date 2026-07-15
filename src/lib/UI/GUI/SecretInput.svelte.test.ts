import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { language } from 'src/lang'
import { MASKED_PROVIDER_SECRET } from 'src/ts/providerSecretMask'
import SecretInputTestHost from './SecretInput.testHost.svelte'

type MountedComponent = Parameters<typeof unmount>[0]
type SecretInputTestHostExports = {
  values: () => { topLevel: string; nested: string; rows: string[] }
  acknowledgeTopLevel: () => void
  selectRow: (index: number) => void
}

let component: MountedComponent | undefined
let host: SecretInputTestHostExports
let target: HTMLElement

function input(label: string): HTMLInputElement {
  const element = target.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!element) throw new Error(`${label} input not found`)
  return element
}

async function type(inputElement: HTMLInputElement, value: string): Promise<void> {
  inputElement.value = value
  inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
  await tick()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  host = mount(SecretInputTestHost, { target }) as unknown as SecretInputTestHostExports
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  if (host) unmount(host as unknown as MountedComponent)
  target.remove()
})

describe('SecretInput masked credential drafts', () => {
  it('keeps masked sentinels bound while never rendering them', () => {
    expect(host.values()).toEqual({
      topLevel: MASKED_PROVIDER_SECRET,
      nested: MASKED_PROVIDER_SECRET,
      rows: [MASKED_PROVIDER_SECRET, MASKED_PROVIDER_SECRET],
    })
    expect(input('Top-level secret').value).toBe('')
    expect(target.innerHTML).not.toContain(MASKED_PROVIDER_SECRET)
    expect(target.querySelectorAll('[data-secret-saved-state]')).toHaveLength(3)
  })

  it('writes replacement bytes exactly for top-level and nested bindings', async () => {
    await type(input('Top-level secret'), '  sk-exact top  ')
    await type(input('Nested secret'), 'nested-secret')

    expect(host.values().topLevel).toBe('  sk-exact top  ')
    expect(host.values().nested).toBe('nested-secret')
  })

  it('returns to saved state when the canonical acknowledgement is masked', async () => {
    await type(input('Top-level secret'), 'replacement')
    host.acknowledgeTopLevel()
    await tick()

    expect(host.values().topLevel).toBe(MASKED_PROVIDER_SECRET)
    expect(input('Top-level secret').value).toBe('')
    expect(input('Top-level secret').placeholder).toBe(language.secretInput.savedPlaceholder)
  })

  it('supports explicit clearing without requiring an input event on the empty field', async () => {
    const topLevelInput = input('Top-level secret')
    const wrapper = topLevelInput.parentElement
    const clearButton = wrapper?.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.secretInput.clearSaved}"]`,
    )
    expect(clearButton).toBeTruthy()

    clearButton!.click()
    await tick()

    expect(host.values().topLevel).toBe('')
    expect(wrapper?.querySelector('[data-secret-saved-state]')).toBeNull()
  })

  it('uses stable wildcard row identity when switching owners', async () => {
    await type(input('Row secret'), 'row-a-replacement')
    host.selectRow(1)
    await tick()

    expect(host.values().rows).toEqual(['row-a-replacement', MASKED_PROVIDER_SECRET])
    expect(input('Row secret').value).toBe('')

    await type(input('Row secret'), 'row-b-replacement')
    expect(host.values().rows).toEqual(['row-a-replacement', 'row-b-replacement'])
  })
})
