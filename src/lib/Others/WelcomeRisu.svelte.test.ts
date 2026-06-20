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
import { DBState } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

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

function textInput(): HTMLTextAreaElement {
  const textarea = target.querySelector<HTMLTextAreaElement>('textarea')
  if (!textarea) {
    throw new Error('Welcome input not found')
  }
  return textarea
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

async function completeOpenAiSetup(): Promise<void> {
  await mountWelcome()
  await setInputAndSend('Ada')
  await clickChoice('Set up now')
  await clickChoice('OpenAI')
  await setInputAndSend('sk-test-key')
  await clickChoice('Creative chat')
  await clickChoice('Long memory')
  await flushAsync()
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(navigator, 'language', {
    configurable: true,
    value: 'en-US',
  })
  DBState.db = {
    didFirstSetup: false,
    username: '',
  } as never
  welcomeMocks.applyOnboardingServerBackedSettings.mockReset()
  welcomeMocks.applyServerBackedSetting.mockReset()
  welcomeMocks.changeLanguage.mockReset()
  welcomeMocks.stopServerSettingsWatch.mockReset()
  welcomeMocks.updateTextThemeAndCSS.mockReset()
  welcomeMocks.watchServerBackedSettings.mockClear()
  welcomeMocks.watchServerBackedSettings.mockReturnValue(welcomeMocks.stopServerSettingsWatch)
  welcomeMocks.applyServerBackedSetting.mockImplementation((key: string, value: unknown) => {
    ;(DBState.db as unknown as Record<string, unknown>)[key] = value
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
  DBState.db = {} as never
})

describe('WelcomeRisu onboarding setup timer', () => {
  it('applies final setup once after the delay with the captured choices', async () => {
    await completeOpenAiSetup()

    vi.advanceTimersByTime(999)
    expect(welcomeMocks.applyOnboardingServerBackedSettings).not.toHaveBeenCalled()
    expect(welcomeMocks.updateTextThemeAndCSS).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await flushAsync()

    expect(welcomeMocks.applyOnboardingServerBackedSettings).toHaveBeenCalledTimes(1)
    expect(welcomeMocks.applyOnboardingServerBackedSettings).toHaveBeenCalledWith({
      chatLang: 1,
      chatMemorySelection: 3,
      provider: 'openai',
    })
    expect(welcomeMocks.updateTextThemeAndCSS).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect(welcomeMocks.applyOnboardingServerBackedSettings).toHaveBeenCalledTimes(1)
    expect(welcomeMocks.updateTextThemeAndCSS).toHaveBeenCalledTimes(1)
  })

  it('does not apply setup or update CSS after unmounting before the timer fires', async () => {
    await completeOpenAiSetup()

    unmount(component!)
    component = undefined
    vi.advanceTimersByTime(1000)
    await flushAsync()

    expect(welcomeMocks.stopServerSettingsWatch).toHaveBeenCalledTimes(1)
    expect(welcomeMocks.applyOnboardingServerBackedSettings).not.toHaveBeenCalled()
    expect(welcomeMocks.updateTextThemeAndCSS).not.toHaveBeenCalled()
  })

  it('does not apply stale setup when first setup completes before the timer fires', async () => {
    await completeOpenAiSetup()

    DBState.db.didFirstSetup = true
    vi.advanceTimersByTime(1000)
    await flushAsync()

    expect(welcomeMocks.applyOnboardingServerBackedSettings).not.toHaveBeenCalled()
    expect(welcomeMocks.updateTextThemeAndCSS).not.toHaveBeenCalled()
  })
})
