import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const welcomeMocks = vi.hoisted(() => ({
  applyOnboardingServerBackedSettings: vi.fn(),
  applyServerBackedSetting: vi.fn(),
  changeLanguage: vi.fn(),
  stopServerSettingsWatch: vi.fn(),
  updateTextThemeAndCSS: vi.fn(),
  watchServerBackedSettings: vi.fn(() => welcomeMocks.stopServerSettingsWatch),
}))

vi.mock('../ChatScreens/Chat.svelte', async () => {
  const mock = await import('../ChatScreens/DefaultChatScreen.testChat.svelte')
  return { default: mock.default }
})

vi.mock('src/lang', () => ({
  changeLanguage: welcomeMocks.changeLanguage,
  language: {
    apiKey: 'API Key',
    hotkeyDesc: {
      send: 'Send',
    },
    recommended: 'Recommended',
    setup: {
      allDone: 'All done',
      chooseChatType: 'Choose chat type',
      chooseChatTypeOption1: 'General chat',
      chooseChatTypeOption1Desc: 'General chat description',
      chooseChatTypeOption2: 'Creative chat',
      chooseChatTypeOption2Desc: 'Creative chat description',
      chooseChatTypeOption3: 'Strict chat',
      chooseChatTypeOption3Desc: 'Strict chat description',
      chooseCheapOrMemory: 'Choose memory mode',
      chooseCheapOrMemoryOption1: 'Cheap mode',
      chooseCheapOrMemoryOption1Desc: 'Cheap mode description',
      chooseCheapOrMemoryOption2: 'Memory mode',
      chooseCheapOrMemoryOption2Desc: 'Memory mode description',
      chooseCheapOrMemoryOption3: 'Balanced mode',
      chooseCheapOrMemoryOption3Desc: 'Balanced mode description',
      chooseCheapOrMemoryOption4: 'Long memory',
      chooseCheapOrMemoryOption4Desc: 'Long memory description',
      claudeDesc: 'Claude description',
      hordeProvider: 'Horde description',
      openAIDesc: 'OpenAI description',
      openRouterProvider: 'OpenRouter description',
      setupClaudeSteps: ['Claude step'],
      setupLaterMessage: 'Setup later {username}',
      setupMessageOption1: 'Set up now',
      setupMessageOption1Desc: 'Set up now description',
      setupMessageOption2: 'Set up later',
      setupOpenAI: 'Enter OpenAI key',
      setupOpenRouter: 'Enter OpenRouter key',
      welcome: 'Welcome',
      welcome2: 'Welcome back {username}',
    },
  },
}))

vi.mock('src/ts/gui/colorscheme', () => ({
  updateTextThemeAndCSS: welcomeMocks.updateTextThemeAndCSS,
}))

vi.mock('src/ts/alert', () => ({
  alertError: vi.fn(),
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  applyOnboardingServerBackedSettings: welcomeMocks.applyOnboardingServerBackedSettings,
  applyServerBackedSetting: welcomeMocks.applyServerBackedSetting,
  watchServerBackedSettings: welcomeMocks.watchServerBackedSettings,
}))

import WelcomeRisu from './WelcomeRisu.svelte'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

let target: HTMLElement
let component: MountedComponent | undefined

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function buttons(): HTMLButtonElement[] {
  return Array.from(target.querySelectorAll('button'))
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = buttons().find((candidate) => candidate.textContent?.includes(text))
  if (!button) {
    throw new Error(`Button not found: ${text}\n${target.textContent ?? ''}`)
  }
  return button
}

function sendButton(): HTMLButtonElement {
  const currentButtons = buttons()
  const button = currentButtons[currentButtons.length - 1]
  if (!button) {
    throw new Error('Send button not found')
  }
  return button
}

function textInput(): HTMLInputElement | HTMLTextAreaElement {
  const input = target.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  if (!input) {
    throw new Error('Welcome input not found')
  }
  return input
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await tick()
}

async function revealWelcomeChat(): Promise<void> {
  const logo = target.querySelector<HTMLElement>('.logo-animation')
  if (!logo) {
    throw new Error('Welcome logo animation element not found')
  }
  logo.dispatchEvent(new Event('animationend'))
  await tick()
}

async function setInputAndSend(value: string): Promise<void> {
  const input = textInput()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  sendButton().click()
  await tick()
}

async function clickChoice(text: string): Promise<void> {
  buttonWithText(text).click()
  await tick()
}

async function mountWelcome(): Promise<void> {
  component = mount(WelcomeRisu, { target })
  await tick()
  await revealWelcomeChat()
}

async function prepareOpenAiSetup(): Promise<void> {
  await mountWelcome()
  await setInputAndSend('Ada')
  await clickChoice('Set up now')
  await clickChoice('OpenAI')
  await setInputAndSend('sk-test-key')
  await clickChoice('Creative chat')
}

async function completeOpenAiSetup(): Promise<void> {
  await prepareOpenAiSetup()
  await clickChoice('Long memory')
  await flushAsync()
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(navigator, 'language', {
    configurable: true,
    value: 'en-US',
  })
  setDatabaseLite({
    didFirstSetup: false,
    username: '',
  } as never)
  welcomeMocks.applyOnboardingServerBackedSettings.mockReset()
  welcomeMocks.applyOnboardingServerBackedSettings.mockResolvedValue(true)
  welcomeMocks.applyServerBackedSetting.mockReset()
  welcomeMocks.changeLanguage.mockReset()
  welcomeMocks.stopServerSettingsWatch.mockReset()
  welcomeMocks.updateTextThemeAndCSS.mockReset()
  welcomeMocks.watchServerBackedSettings.mockClear()
  welcomeMocks.watchServerBackedSettings.mockReturnValue(welcomeMocks.stopServerSettingsWatch)
  welcomeMocks.applyServerBackedSetting.mockImplementation((key: string, value: unknown) => {
    ;(getDatabase() as unknown as Record<string, unknown>)[key] = value
  })
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  vi.clearAllTimers()
  vi.useRealTimers()
  target.remove()
  setDatabaseLite({} as never)
})

describe('WelcomeRisu onboarding setup completion', () => {
  it('names the icon-only send action', async () => {
    await mountWelcome()
    expect(sendButton().getAttribute('aria-label')).toBe('Send')
  })

  it('masks and names provider credentials', async () => {
    await mountWelcome()
    await setInputAndSend('Ada')
    await clickChoice('Set up now')
    await clickChoice('OpenAI')

    const credential = target.querySelector<HTMLInputElement>('input[type="password"]')
    expect(credential).toBeTruthy()
    expect(credential?.getAttribute('aria-label')).toBe('OpenAI API Key')
    expect(credential?.autocomplete).toBe('new-password')
    expect(target.querySelector('textarea')).toBeNull()
  })

  it.each([
    ['zh-CN', 'cn'],
    ['zh-Hans-SG', 'cn'],
    ['zh-TW', 'zh-Hant'],
    ['zh-Hant-HK', 'zh-Hant'],
    ['es-MX', 'es'],
  ])('maps browser locale %s to supported language %s', async (browserLocale, expectedLanguage) => {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: browserLocale,
    })

    component = mount(WelcomeRisu, { target })
    await tick()

    expect(welcomeMocks.changeLanguage).toHaveBeenCalledWith(expectedLanguage)
    expect(welcomeMocks.applyServerBackedSetting).toHaveBeenCalledWith('language', expectedLanguage)
  })

  it('shows completion only after the captured final choices persist successfully', async () => {
    const persistence = createDeferred<boolean>()
    welcomeMocks.applyOnboardingServerBackedSettings.mockReturnValueOnce(persistence.promise)
    await prepareOpenAiSetup()

    const finalChoice = buttonWithText('Long memory')
    finalChoice.click()
    expect(welcomeMocks.applyOnboardingServerBackedSettings).toHaveBeenCalledTimes(1)
    finalChoice.click()
    await flushAsync()

    expect(welcomeMocks.applyOnboardingServerBackedSettings).toHaveBeenCalledTimes(1)
    expect(welcomeMocks.applyOnboardingServerBackedSettings).toHaveBeenCalledWith({
      chatLang: 1,
      chatMemorySelection: 3,
      provider: 'openai',
    })
    expect(target.textContent).not.toContain('All done')
    expect(welcomeMocks.updateTextThemeAndCSS).not.toHaveBeenCalled()

    persistence.resolve(true)
    await flushAsync()

    expect(target.textContent).toContain('All done')
    expect(welcomeMocks.applyOnboardingServerBackedSettings).toHaveBeenCalledTimes(1)
    expect(welcomeMocks.updateTextThemeAndCSS).toHaveBeenCalledTimes(1)
  })

  it('keeps an in-flight final save alive while invalidating UI completion after unmount', async () => {
    const persistence = createDeferred<boolean>()
    welcomeMocks.applyOnboardingServerBackedSettings.mockReturnValueOnce(persistence.promise)
    await prepareOpenAiSetup()
    await clickChoice('Long memory')

    unmount(component!)
    component = undefined
    persistence.resolve(true)
    await flushAsync()

    expect(welcomeMocks.stopServerSettingsWatch).toHaveBeenCalledTimes(1)
    expect(welcomeMocks.applyOnboardingServerBackedSettings).toHaveBeenCalledTimes(1)
    expect(welcomeMocks.updateTextThemeAndCSS).not.toHaveBeenCalled()
  })

  it('restores the final choice step after a failed save and permits one retry', async () => {
    welcomeMocks.applyOnboardingServerBackedSettings.mockResolvedValueOnce(false)
    await completeOpenAiSetup()

    expect(target.textContent).not.toContain('All done')
    expect(welcomeMocks.updateTextThemeAndCSS).not.toHaveBeenCalled()
    expect(buttonWithText('Long memory')).toBeTruthy()

    await clickChoice('Long memory')
    await flushAsync()

    expect(welcomeMocks.applyOnboardingServerBackedSettings).toHaveBeenCalledTimes(2)
    expect(target.textContent).toContain('All done')
    expect(welcomeMocks.updateTextThemeAndCSS).toHaveBeenCalledTimes(1)
  })

  it('does not start final setup after onboarding has already completed elsewhere', async () => {
    await prepareOpenAiSetup()
    getDatabase().didFirstSetup = true
    await clickChoice('Long memory')

    expect(welcomeMocks.applyOnboardingServerBackedSettings).not.toHaveBeenCalled()
    expect(target.textContent).not.toContain('All done')
  })
})
