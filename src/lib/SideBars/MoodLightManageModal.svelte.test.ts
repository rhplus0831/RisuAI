import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const moodLightModalMocks = vi.hoisted(() => ({
  getCharImage: vi.fn(async (image: string) => `background-image:url(${image})`),
}))

vi.mock('src/ts/characters', () => ({
  getCharImage: moodLightModalMocks.getCharImage,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  getModuleTriggers: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import MoodLightManageModal from './MoodLightManageModal.svelte'
import { changeLanguage, language } from 'src/lang'
import { toggleMoodLightManagementTarget, type MoodLightManagementTarget } from 'src/ts/moodLightMembership'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function seedMoodLightDatabase() {
  setDatabaseLite({
    characterOrder: [
      'root-protected',
      'root-open',
      {
        id: 'folder-a',
        name: 'Archive Room',
        color: 'blue',
        data: ['child-protected', 'child-open'],
      },
    ],
    characters: [
      { chaId: 'root-protected', name: 'Root Guard', image: 'guard.png' },
      { chaId: 'root-open', name: 'Public Root', image: '' },
      { chaId: 'child-protected', name: 'Nested Match', image: '' },
      { chaId: 'child-open', name: 'Folder Friend', image: '' },
    ],
    moodLightMembership: {
      characterIds: ['root-protected'],
      folders: [
        {
          id: 'folder-a',
          characterIds: ['child-protected', 'child-open'],
          excludedCharacterIds: ['child-open'],
        },
      ],
    },
  } as never)
}

function targetButton(kind: 'character' | 'folder', id: string): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>(
    `button[data-risu-mood-light-target="${kind}"][data-risu-target-id="${id}"]`,
  )
  expect(button, `${kind} target ${id}`).toBeTruthy()
  return button!
}

function updateSearch(value: string): Promise<void> {
  const input = target.querySelector<HTMLInputElement>(`input[aria-label="${language.search}"]`)
  expect(input).toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true }))
  return tick()
}

function mountModal(
  options: {
    close?: () => void
    onToggle?: (target: MoodLightManagementTarget) => void
    pending?: boolean
  } = {},
) {
  component = mount(MoodLightManageModal, {
    target,
    props: {
      close: options.close,
      onToggle: options.onToggle,
      pending: options.pending,
    },
  })
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.clearAllMocks()
  changeLanguage('en')
  seedMoodLightDatabase()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  setDatabaseLite({} as never)
})

describe('MoodLightManageModal', () => {
  it('renders grouped targets with live protection exposed through aria-pressed', async () => {
    mountModal()
    await tick()

    expect(target.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(language.moodLightManage)
    expect(targetButton('character', 'root-protected').getAttribute('aria-pressed')).toBe('true')
    expect(targetButton('character', 'root-open').getAttribute('aria-pressed')).toBe('false')
    expect(targetButton('folder', 'folder-a').getAttribute('aria-pressed')).toBe('true')
    expect(targetButton('character', 'child-protected').getAttribute('aria-pressed')).toBe('true')
    expect(targetButton('character', 'child-open').getAttribute('aria-pressed')).toBe('false')
    expect(target.querySelector('[data-risu-mood-light-root-characters]')?.textContent).toContain('Root Guard')
    expect(target.querySelector('[data-risu-mood-light-folder-section]')?.textContent).toContain('Nested Match')
    expect(document.activeElement).toBe(target.querySelector(`input[aria-label="${language.search}"]`))
    await vi.waitFor(() => expect(moodLightModalMocks.getCharImage).toHaveBeenCalledWith('guard.png', 'css'))
  })

  it('updates the live selection and stays open after a character toggle', async () => {
    const onToggle = vi.fn((selectedTarget: MoodLightManagementTarget) => {
      setDatabaseLite({
        ...getDatabase(),
        moodLightMembership: toggleMoodLightManagementTarget(getDatabase(), selectedTarget),
      } as never)
    })
    mountModal({ onToggle })
    await tick()

    targetButton('character', 'root-open').click()
    await tick()

    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'character', id: 'root-open', name: 'Public Root' }),
    )
    expect(targetButton('character', 'root-open').getAttribute('aria-pressed')).toBe('true')
    expect(target.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it('normalizes search and preserves folder context for folder or child matches', async () => {
    mountModal()
    await tick()

    await updateSearch('NE STED')
    expect(target.querySelector('[data-risu-target-id="root-protected"]')).toBeNull()
    expect(targetButton('folder', 'folder-a')).toBeTruthy()
    expect(targetButton('character', 'child-protected')).toBeTruthy()
    expect(target.querySelector('[data-risu-target-id="child-open"]')).toBeNull()

    await updateSearch('ARCH IVE')
    expect(targetButton('folder', 'folder-a')).toBeTruthy()
    expect(targetButton('character', 'child-protected')).toBeTruthy()
    expect(targetButton('character', 'child-open')).toBeTruthy()

    await updateSearch('missing')
    expect(target.querySelector('[data-risu-mood-light-target]')).toBeNull()
    expect(target.querySelector('[role="status"]')?.textContent).toContain(language.noSearchResults)
  })

  it('keeps search editable while pending and disables only membership toggles', async () => {
    mountModal({ pending: true })
    await tick()

    expect(target.querySelector<HTMLInputElement>(`input[aria-label="${language.search}"]`)?.disabled).toBe(false)
    expect(targetButton('character', 'root-protected').disabled).toBe(true)
    expect(targetButton('folder', 'folder-a').disabled).toBe(true)
  })

  it('requests close from the X button, Escape, and only direct backdrop clicks', async () => {
    const close = vi.fn()
    mountModal({ close })
    await tick()

    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.close}"]`)!.click()
    expect(close).toHaveBeenCalledTimes(1)

    target
      .querySelector<HTMLInputElement>(`input[aria-label="${language.search}"]`)!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(close).toHaveBeenCalledTimes(2)

    target.querySelector<HTMLElement>('[data-risu-mood-light-dialog-root]')!.click()
    expect(close).toHaveBeenCalledTimes(3)

    target.querySelector<HTMLElement>('[role="dialog"]')!.click()
    expect(close).toHaveBeenCalledTimes(3)
  })
})
