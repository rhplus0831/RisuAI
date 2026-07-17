import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translationMocks = vi.hoisted(() => ({
  clearLLMCache: vi.fn(),
  runTranslator: vi.fn(),
  tokenize: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/translator/translator', () => ({
  clearLLMCache: translationMocks.clearLLMCache,
  runTranslator: translationMocks.runTranslator,
}))

vi.mock('src/ts/tokenizer', () => ({
  tokenize: translationMocks.tokenize,
}))

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/globalApi.svelte')>()
  return {
    ...actual,
    getLanguageCodes: () => [
      { code: 'en', name: 'English' },
      { code: 'ko', name: 'Korean' },
      { code: 'ja', name: 'Japanese' },
    ],
  }
})

import PlaygroundTranslation from './PlaygroundTranslation.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  translationMocks.clearLLMCache.mockReset()
  translationMocks.clearLLMCache.mockResolvedValue(undefined)
  translationMocks.runTranslator.mockReset()
  translationMocks.tokenize.mockReset()
  translationMocks.tokenize.mockResolvedValue(0)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  vi.restoreAllMocks()
})

function textareas(): NodeListOf<HTMLTextAreaElement> {
  return target.querySelectorAll('textarea')
}

async function setSource(value: string): Promise<void> {
  const source = textareas()[0]
  if (!source) throw new Error('Translation source input not found')
  source.value = value
  source.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

async function setLanguage(index: number, value: string): Promise<void> {
  const select = target.querySelectorAll('select')[index]
  if (!(select instanceof HTMLSelectElement)) throw new Error(`Language selector ${index} not found`)
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await tick()
}

async function enableBulk(keepContext = false): Promise<void> {
  const bulk = target.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!bulk) throw new Error('Bulk translation checkbox not found')
  bulk.click()
  await tick()

  if (keepContext) {
    const context = target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]
    if (!context) throw new Error('Keep-context checkbox not found')
    context.click()
    await tick()
  }
}

function translateButton(): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes('Translate'),
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error('Translate button not found')
  return button
}

async function waitForIdle(): Promise<void> {
  await vi.waitFor(() => expect(translateButton().textContent?.trim()).toBe('Translate'))
}

describe('PlaygroundTranslation run ownership and failures', () => {
  it('names language, text, and toggle controls while exposing checked state', async () => {
    component = mount(PlaygroundTranslation, { target })

    expect(Array.from(target.querySelectorAll('select'), (select) => select.getAttribute('aria-label'))).toEqual([
      language.sourceLanguage,
      language.translatorLanguage,
    ])
    expect(Array.from(textareas(), (input) => input.getAttribute('aria-label'))).toEqual([
      language.playground.translationSourceText,
      language.playground.translationOutputText,
    ])

    const bulk = target.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(bulk?.getAttribute('aria-label')).toBe(language.playground.translationBulk)
    expect(bulk?.checked).toBe(false)
    bulk!.click()
    await tick()
    expect(bulk?.checked).toBe(true)

    const keepContext = target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]
    expect(keepContext?.getAttribute('aria-label')).toBe(language.playground.translationKeepContext)
    expect(keepContext?.checked).toBe(false)
    keepContext?.click()
    await tick()
    expect(keepContext?.checked).toBe(true)
  })

  it('reports a rejected single translation and clears the failure after a successful retry', async () => {
    const firstTranslation = deferred<string>()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    translationMocks.runTranslator.mockReturnValueOnce(firstTranslation.promise).mockResolvedValueOnce('translated')
    component = mount(PlaygroundTranslation, { target })
    await setSource('source text')

    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledOnce())
    firstTranslation.reject(new Error('provider unavailable'))
    await waitForIdle()

    expect(textareas()[1]?.value).toBe('')
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('Translation failed: provider unavailable')

    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledTimes(2))
    await waitForIdle()

    expect(textareas()[1]?.value).toBe('translated')
    expect(target.querySelector('[role="alert"]')).toBeNull()
    expect(consoleError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('leaves a failed bulk JSON chunk empty while preserving successful deferred chunks', async () => {
    const firstTranslation = deferred<string>()
    const secondTranslation = deferred<string>()
    const thirdTranslation = deferred<string>()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    translationMocks.runTranslator
      .mockReturnValueOnce(firstTranslation.promise)
      .mockReturnValueOnce(secondTranslation.promise)
      .mockReturnValueOnce(thirdTranslation.promise)
    component = mount(PlaygroundTranslation, { target })
    await setSource(
      JSON.stringify([
        { text: 'first', metadata: 'one' },
        { text: 'failed source', metadata: 'two' },
        { text: 'third', metadata: 'three' },
      ]),
    )
    await enableBulk()

    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledTimes(1))
    firstTranslation.resolve('first translated')
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledTimes(2))
    secondTranslation.reject(new Error('chunk provider failure'))
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledTimes(3))
    thirdTranslation.resolve('third translated')
    await waitForIdle()

    expect(JSON.parse(textareas()[1]?.value ?? '')).toEqual([
      { text: 'first translated', metadata: 'one' },
      { text: '', metadata: 'two' },
      { text: 'third translated', metadata: 'three' },
    ])
    expect(textareas()[1]?.value).not.toContain('failed source')
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('Chunk 2 of 3 failed: chunk provider failure')
  })

  it('translates the text field of a single JSON object without dropping its metadata', async () => {
    translationMocks.runTranslator.mockResolvedValueOnce('translated hello')
    component = mount(PlaygroundTranslation, { target })
    await setSource('{"text":"hello","metadata":"kept"}')
    await enableBulk()

    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledOnce())
    await waitForIdle()

    expect(translationMocks.runTranslator).toHaveBeenCalledWith('hello', false, 'en', expect.any(String), {
      translatorNote: '',
    })
    expect(JSON.parse(textareas()[1]?.value ?? '')).toEqual({ text: 'translated hello', metadata: 'kept' })
  })

  it('falls back to translating valid non-collection JSON instead of silently echoing it', async () => {
    const source = '{"metadata":"hello"}'
    translationMocks.runTranslator.mockResolvedValueOnce('translated document')
    component = mount(PlaygroundTranslation, { target })
    await setSource(source)
    await enableBulk()

    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledOnce())
    await waitForIdle()

    expect(translationMocks.runTranslator).toHaveBeenCalledWith(source, false, 'en', expect.any(String), {
      translatorNote: '',
    })
    expect(textareas()[1]?.value).toBe('translated document')
  })

  it('releases loading and permits a retry when the source changes during translation', async () => {
    const firstTranslation = deferred<string>()
    translationMocks.runTranslator
      .mockReturnValueOnce(firstTranslation.promise)
      .mockResolvedValueOnce('retry translated')
    component = mount(PlaygroundTranslation, { target })
    await setSource('[{"text":"first"}]')
    await enableBulk()

    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledOnce())
    await setSource('{"broken"')
    firstTranslation.resolve('first translated')

    await waitForIdle()
    expect(textareas()[1]?.value).toBe('')

    await setSource('[{"text":"retry","metadata":"preserved"}]')
    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledTimes(2))
    await waitForIdle()

    expect(JSON.parse(textareas()[1]?.value ?? '')).toEqual([{ text: 'retry translated', metadata: 'preserved' }])
  })

  it('does not mix languages or publish output after settings change in flight', async () => {
    const firstTranslation = deferred<string>()
    translationMocks.runTranslator.mockReturnValueOnce(firstTranslation.promise)
    component = mount(PlaygroundTranslation, { target })
    await setSource('[{"text":"first"},{"text":"second"}]')
    await setLanguage(0, 'en')
    await setLanguage(1, 'ko')
    await enableBulk(true)

    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledOnce())
    expect(translationMocks.runTranslator).toHaveBeenCalledWith('first', false, 'en', 'ko', {
      translatorNote: '',
    })

    await setLanguage(1, 'ja')
    firstTranslation.resolve('first translated')

    await waitForIdle()
    expect(translationMocks.runTranslator).toHaveBeenCalledOnce()
    expect(textareas()[1]?.value).toBe('')
  })

  it('clears a completed result as soon as its source changes', async () => {
    translationMocks.runTranslator.mockResolvedValueOnce('translated result')
    component = mount(PlaygroundTranslation, { target })
    await setSource('first source')

    translateButton().click()
    await vi.waitFor(() => expect(textareas()[1]?.value).toBe('translated result'))

    await setSource('new source')

    expect(textareas()[1]?.value).toBe('')
    expect(target.querySelector('[role="alert"]')).toBeNull()
  })

  it('clears published bulk output before a later stale chunk settles', async () => {
    const firstTranslation = deferred<string>()
    const secondTranslation = deferred<string>()
    translationMocks.runTranslator
      .mockReturnValueOnce(firstTranslation.promise)
      .mockReturnValueOnce(secondTranslation.promise)
    component = mount(PlaygroundTranslation, { target })
    await setSource('first\n\nsecond')
    await enableBulk()

    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledOnce())
    firstTranslation.resolve('first translated')
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledTimes(2))
    expect(textareas()[1]?.value).toBe('first translated')

    await setSource('replacement source')

    expect(textareas()[1]?.value).toBe('')
    secondTranslation.resolve('stale second translation')
    await waitForIdle()
    expect(textareas()[1]?.value).toBe('')
  })

  it('uses the captured context settings consistently across chunks', async () => {
    translationMocks.runTranslator.mockResolvedValueOnce('first translated').mockResolvedValueOnce('second translated')
    translationMocks.tokenize.mockResolvedValue(7)
    component = mount(PlaygroundTranslation, { target })
    await setSource('[{"text":"first"},{"text":"second"}]')
    await setLanguage(0, 'en')
    await setLanguage(1, 'ko')
    await enableBulk(true)

    translateButton().click()
    await vi.waitFor(() => expect(translationMocks.runTranslator).toHaveBeenCalledTimes(2))
    await waitForIdle()

    expect(translationMocks.runTranslator.mock.calls[1]).toEqual([
      'second',
      false,
      'en',
      'ko',
      {
        translatorNote: expect.stringContaining('<Original>first</Original><Translated>first translated</Translated>'),
      },
    ])
    expect(translationMocks.tokenize).toHaveBeenCalledWith(
      '<Original>first</Original><Translated>first translated</Translated>',
    )
    expect(JSON.parse(textareas()[1]?.value ?? '')).toEqual([
      { text: 'first translated' },
      { text: 'second translated' },
    ])
  })
})
