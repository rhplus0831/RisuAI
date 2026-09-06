import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const playgroundMocks = vi.hoisted(() => ({
  encodeWithTokenizer: vi.fn(),
  parseMarkdown: vi.fn(),
}))

vi.mock('src/ts/parser/parser.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/parser/parser.svelte')>()
  return {
    ...actual,
    ParseMarkdown: playgroundMocks.parseMarkdown,
  }
})

vi.mock('src/ts/tokenizer', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/tokenizer')>()
  return {
    ...actual,
    encodeWithTokenizer: playgroundMocks.encodeWithTokenizer,
  }
})

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import PlaygroundParser from './PlaygroundParser.svelte'
import PlaygroundTokenizer from './PlaygroundTokenizer.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

let component: MountedComponent | undefined
let target: HTMLElement

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  playgroundMocks.encodeWithTokenizer.mockReset()
  playgroundMocks.parseMarkdown.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('playground async output freshness', () => {
  it('does not let an older parser result replace the latest input result', async () => {
    const older = deferred<string>()
    playgroundMocks.parseMarkdown.mockReturnValueOnce(older.promise).mockResolvedValueOnce('new result')
    component = mount(PlaygroundParser, { target })
    const [input, output] = Array.from(target.querySelectorAll('textarea'))

    setTextareaValue(input, 'old input')
    setTextareaValue(input, 'new input')
    await vi.waitFor(() => expect(output.value).toBe('new result'))

    older.resolve('old result')
    await tick()
    expect(output.value).toBe('new result')
  })

  it('does not let an older tokenizer result replace the latest tokens', async () => {
    const older = deferred<Uint32Array>()
    playgroundMocks.encodeWithTokenizer.mockReturnValueOnce(older.promise).mockResolvedValueOnce(new Uint32Array([2]))
    component = mount(PlaygroundTokenizer, { target })
    const [input, output] = Array.from(target.querySelectorAll('textarea'))

    setTextareaValue(input, 'old input')
    setTextareaValue(input, 'new input')
    await vi.waitFor(() => expect(output.value).toBe('[2]'))

    older.resolve(new Uint32Array([1]))
    await tick()
    expect(output.value).toBe('[2]')
  })
})

describe('playground async control names', () => {
  it('names the parser and tokenizer inputs and outputs', () => {
    component = mount(PlaygroundParser, { target })

    expect(Array.from(target.querySelectorAll('textarea'), (input) => input.getAttribute('aria-label'))).toEqual([
      language.input,
      language.playground.outputHtml,
    ])

    unmount(component)
    component = undefined
    component = mount(PlaygroundTokenizer, { target })

    expect(target.querySelector('select')?.getAttribute('aria-label')).toBe(language.tokenizer)
    expect(Array.from(target.querySelectorAll('textarea'), (input) => input.getAttribute('aria-label'))).toEqual([
      language.input,
      language.playground.result,
    ])
  })
})
