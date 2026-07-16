import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import MultiLangInputTestHost from './MultiLangInput.testHost.svelte'
import { addLanguageIfMissing } from './MultiLangInput.svelte'
import { language } from 'src/lang'
import { encodeMultilangString, parseMultilangString, toLangName } from 'src/ts/util'

type MountedHost = Parameters<typeof unmount>[0] & {
  currentValue: () => string
  switchValue: (nextValue: string) => void
}

let target: HTMLElement
let component: MountedHost | undefined

function textarea(): HTMLTextAreaElement {
  const input = target.querySelector('textarea')
  if (!input) throw new Error('multilingual textarea not found')
  return input
}

function languageButton(code: string): HTMLButtonElement {
  const label = toLangName(code)
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) throw new Error(`language button not found: ${code}`)
  return button
}

async function enterText(text: string): Promise<void> {
  const input = textarea()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

function languageButtons(code: string): HTMLButtonElement[] {
  const label = toLangName(code)
  return Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter(
    (candidate) => candidate.textContent?.trim() === label,
  )
}

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
  document.body.innerHTML = ''
})

describe('MultiLangInput external value changes', () => {
  it('falls back from a removed language and preserves legacy creator notes while editing', async () => {
    component = mount(MultiLangInputTestHost, {
      target,
      props: {
        initialValue: encodeMultilangString({ en: 'English note', fr: 'Note française' }),
      },
    }) as MountedHost
    await tick()

    const addLanguage = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.add} ${language.language}"]`,
    )
    expect(addLanguage?.getAttribute('aria-expanded')).toBe('false')

    languageButton('fr').click()
    await tick()
    expect(languageButton('fr').getAttribute('aria-pressed')).toBe('true')
    expect(languageButton('en').getAttribute('aria-pressed')).toBe('false')
    expect(textarea().value).toBe('Note française')

    component.switchValue('Legacy creator note')
    await tick()

    expect(languageButton('en')).toBeTruthy()
    expect(textarea().value).toBe('Legacy creator note')

    await enterText('Legacy creator note updated')

    const parsed = parseMultilangString(component.currentValue())
    expect(parsed.en).toBe('Legacy creator note updated')
    expect(component.currentValue()).toContain('Legacy creator note updated')
  })

  it('selects the first available language when English is absent after a switch', async () => {
    component = mount(MultiLangInputTestHost, {
      target,
      props: {
        initialValue: encodeMultilangString({ en: 'English note', fr: 'Note française' }),
      },
    }) as MountedHost
    await tick()

    languageButton('fr').click()
    await tick()
    component.switchValue(encodeMultilangString({ ja: '日本語のメモ' }))
    await tick()

    expect(languageButton('ja')).toBeTruthy()
    expect(textarea().value).toBe('日本語のメモ')
  })

  it('migrates substantive hidden legacy content without dropping an existing English note', async () => {
    component = mount(MultiLangInputTestHost, {
      target,
      props: { initialValue: encodeMultilangString({ fr: 'Note française' }) },
    }) as MountedHost
    await tick()

    component.switchValue('Legacy prefix\n# `en`\nEnglish note')
    await tick()

    expect(textarea().value).toBe('Legacy prefix\nEnglish note')

    await enterText('Legacy prefix\nEnglish note updated')
    expect(parseMultilangString(component.currentValue()).en).toBe('Legacy prefix\nEnglish note updated')
  })
})

describe('MultiLangInput language additions', () => {
  it('does not offer an already-present English language', async () => {
    component = mount(MultiLangInputTestHost, {
      target,
      props: { initialValue: encodeMultilangString({ en: 'Existing English value' }) },
    }) as MountedHost
    await tick()

    const addLanguage = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.add} ${language.language}"]`,
    )
    addLanguage?.click()
    await tick()

    expect(addLanguage?.getAttribute('aria-expanded')).toBe('true')
    expect(languageButtons('en')).toHaveLength(1)
    expect(textarea().value).toBe('Existing English value')
  })

  it('refuses a duplicate English addition without clearing its existing value', () => {
    const valueByLanguage = { en: 'Existing English value' }

    expect(addLanguageIfMissing(valueByLanguage, 'en')).toBe(false)
    expect(valueByLanguage.en).toBe('Existing English value')
  })
})
