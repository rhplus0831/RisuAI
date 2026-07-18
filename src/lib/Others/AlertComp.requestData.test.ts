import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/sourcemap', () => ({ translateStackTrace: vi.fn() }))
vi.mock('src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import AlertComp from './AlertComp.svelte'
import { alertRequestData } from 'src/ts/alert'
import { language } from 'src/lang'
import { getDatabase, setDatabaseLite, type MessageGenerationInfo } from 'src/ts/storage/database.svelte'
import { alertStore, selectedCharID } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined
const inspectedGeneration: MessageGenerationInfo = {
  generationId: 'generation-target',
  model: 'model-target',
  inputTokens: 12,
  outputTokens: 4,
  maxContext: 100,
}

function seedRequestDataDatabase(): void {
  setDatabaseLite({
    characters: [
      {
        chaId: 'character-a',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            message: [
              { role: 'user', data: 'before', chatId: 'message-before' },
              {
                role: 'char',
                data: 'inspected text',
                chatId: 'message-target',
                saying: 'Inspected speaker',
                generationInfo: inspectedGeneration,
              },
              {
                role: 'char',
                data: 'other text',
                chatId: 'message-other',
                saying: 'Other speaker',
                generationInfo: { ...inspectedGeneration, generationId: 'generation-other' },
              },
            ],
          },
        ],
      },
    ],
  } as any)
}

function metadataValue(label: string): string | undefined {
  const labelElement = Array.from(target.querySelectorAll('span')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  return labelElement?.nextElementSibling?.textContent?.trim()
}

async function openRequestMetadata(): Promise<void> {
  alertRequestData({ genInfo: inspectedGeneration, idx: 1 })
  await tick()
  const metadataButton = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === language.metaData,
  )
  expect(metadataButton).toBeTruthy()
  metadataButton?.click()
  await tick()
}

beforeEach(() => {
  alertStore.set({ type: 'none', msg: '' })
  selectedCharID.set(0)
  seedRequestDataDatabase()
  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(AlertComp, { target })
})

afterEach(() => {
  alertStore.set({ type: 'none', msg: '' })
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  selectedCharID.set(-1)
  setDatabaseLite({} as any)
})

describe('AlertComp request-data message ownership', () => {
  it('keeps metadata bound to the inspected message when its live index shifts', async () => {
    await openRequestMetadata()
    expect(metadataValue('ID')).toBe('message-target')
    expect(metadataValue('Saying')).toBe('Inspected speaker')

    getDatabase().characters[0].chats[0].message.unshift({
      role: 'user',
      data: 'inserted before inspector target',
      chatId: 'message-inserted',
    })
    await tick()

    expect(metadataValue('Index')).toBe('2')
    expect(metadataValue('ID')).toBe('message-target')
    expect(metadataValue('Saying')).toBe('Inspected speaker')
    expect(target.textContent).not.toContain('Other speaker')
  })

  it('reports when the inspected message is removed', async () => {
    await openRequestMetadata()
    const messages = getDatabase().characters[0].chats[0].message
    messages.splice(
      messages.findIndex((message) => message.chatId === 'message-target'),
      1,
    )
    await tick()

    expect(target.querySelector('[role="status"]')?.textContent).toContain(language.errors.requestDataMessageMissing)
    expect(metadataValue('ID')).toBeUndefined()
  })
})
