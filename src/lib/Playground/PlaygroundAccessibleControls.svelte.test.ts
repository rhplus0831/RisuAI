import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/parser/parser.svelte', () => ({
  parseMarkdownSafe: (value: string) => value,
  risuChatParser: (value: string) => value,
}))

vi.mock('src/ts/cbs', () => ({
  defaultCBSRegisterArg: {},
  registerCBS: vi.fn(),
}))

import { language } from 'src/lang'
import PlaygroundDocs from './PlaygroundDocs.svelte'
import PlaygroundJinja from './PlaygroundJinja.svelte'
import PlaygroundSyntax from './PlaygroundSyntax.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

function remount(next: typeof PlaygroundDocs | typeof PlaygroundJinja | typeof PlaygroundSyntax): void {
  if (component) unmount(component)
  component = mount(next, { target })
}

describe('Playground static control names', () => {
  it('names the Jinja template, data, and result editors', () => {
    remount(PlaygroundJinja)

    expect(Array.from(target.querySelectorAll('textarea'), (input) => input.getAttribute('aria-label'))).toEqual([
      language.playground.jinjaTemplate,
      language.playground.jinjaData,
      language.playground.result,
    ])
  })

  it('names both syntax editors across contenteditable and textarea modes', () => {
    remount(PlaygroundSyntax)

    expect(target.querySelector(`[aria-label="${language.input}"]`)?.matches('textarea, [role="textbox"]')).toBe(true)
    expect(
      target.querySelector(`[aria-label="${language.playground.result}"]`)?.matches('textarea, [role="textbox"]'),
    ).toBe(true)
  })

  it('names the documentation search field independently of its placeholder', () => {
    remount(PlaygroundDocs)

    const search = target.querySelector('input')
    expect(search?.getAttribute('aria-label')).toBe(language.playground.docsSearch)
    expect(search?.placeholder).toBe(language.playground.docsSearch)
  })
})
