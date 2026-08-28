import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const characterSpies = vi.hoisted(() => ({
  getCharImage: vi.fn(),
}))

const sortableSpies = vi.hoisted(() => ({
  create: vi.fn(() => ({ destroy: vi.fn() })),
}))

vi.mock('src/ts/characters', () => ({
  getCharImage: characterSpies.getCharImage,
}))

vi.mock('sortablejs/modular/sortable.core.esm.js', () => ({
  default: sortableSpies,
}))

import PersonaSettings from './PersonaSettings.svelte'
import { language } from 'src/lang'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  characterSpies.getCharImage.mockReset().mockResolvedValue('background-image: url("persona")')
  sortableSpies.create.mockClear()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as any)
})

describe('PersonaSettings owner changes', () => {
  it('renders safely when the selected persona disappears from an authoritative projection', async () => {
    setDatabaseLite({
      characters: [],
      enabledModules: [],
      loreBook: [],
      loreBookPage: 0,
      modules: [],
      personaPrompt: '',
      personas: [],
      selectedPersona: 0,
      userIcon: 'persona-icon',
      username: 'Missing persona',
      userNote: '',
    } as any)

    component = mount(PersonaSettings, { target })
    await tick()

    expect(target.querySelector('h2')?.textContent).toBe(language.persona)
    expect(characterSpies.getCharImage).toHaveBeenCalledWith('persona-icon', 'css')
    expect(target.textContent).toContain(language.largePortrait)
  })
})
