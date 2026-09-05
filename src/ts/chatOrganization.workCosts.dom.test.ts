import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import * as commands from './chatCommands'
import { seedCloneCostDb, withCloneInstrumentation } from './__tests__/cloneCostHarness'
import { reportBrowserWork } from './__tests__/browserWorkProbe'
import { charactersResourceState } from './server/resourceState.svelte'
import type { Chat, Message } from './storage/database.svelte'
import { selectedCharID } from './stores.svelte'

const baseline = process.env.RISU_CHAT_ORGANIZATION_BASELINE === '1'
const fixtures = [
  { name: 'small', unrelatedCharacters: 1, otherHistory: 2 },
  { name: 'intermediate', unrelatedCharacters: 8, otherHistory: 100 },
  { name: 'large', unrelatedCharacters: 32, otherHistory: 1_000 },
]

function history(count: number, owner: string): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    role: 'char',
    chatId: `${owner}-message-${index}`,
    data: 'x'.repeat(256),
  }))
}

function installFixture(fixture: (typeof fixtures)[number]) {
  const seed = seedCloneCostDb({
    characterCount: fixture.unrelatedCharacters + 1,
    hydratedMessageCount: 2,
    messageBodySize: 256,
  })
  const owner = seed.characters[0]
  owner.desc = 'Unchanged character biography. '.repeat(256)
  owner.chatFolders = [
    { id: 'folder-a', name: 'A', folded: false },
    { id: 'folder-b', name: 'B', folded: false },
  ]
  owner.chats[0].folderId = 'folder-a'
  owner.chats.push({
    id: 'target-sibling',
    name: 'Sibling',
    note: '',
    localLore: [],
    folderId: 'folder-b',
    message: history(fixture.otherHistory, 'sibling'),
  })
  owner.chatPage = 1
  for (let index = 1; index < seed.characters.length; index++)
    seed.characters[index].chats[0].message = history(fixture.otherHistory, `other-${index}`)
  charactersResourceState.characters = seed.characters
  charactersResourceState.status = 'ready'
  selectedCharID.set(0)
  return charactersResourceState.characters[0]
}

function messageIds(value: unknown, seen = new Set<object>()): string[] {
  if (!value || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  if (value instanceof Map) return [...value.values()].flatMap((entry) => messageIds(entry, seen))
  if (value instanceof Set) return [...value].flatMap((entry) => messageIds(entry, seen))
  const record = value as Record<string, unknown>
  if (
    (record.role === 'user' || record.role === 'char') &&
    typeof record.data === 'string' &&
    typeof record.chatId === 'string'
  )
    return [record.chatId]
  return Object.values(record).flatMap((entry) => messageIds(entry, seen))
}

const created: Chat = { id: 'created-chat', name: 'Created', note: '', localLore: [], message: [] }
const folder = { id: 'created-folder', name: 'Created folder', folded: false }
const captures = [
  { kind: 'create', run: () => commands.captureChatCreateSnapshot('char-0', created), bodies: 'none' },
  { kind: 'folder-create', run: () => commands.captureChatFolderCreateSnapshot('char-0', folder), bodies: 'none' },
  { kind: 'delete', run: () => commands.captureChatDeleteSnapshot('chat-0', 'char-0'), bodies: 'target' },
  { kind: 'folder-delete', run: () => commands.captureChatFolderDeleteSnapshot('folder-a', 'char-0'), bodies: 'none' },
  { kind: 'order', run: () => commands.captureChatOrderSnapshot('char-0'), bodies: 'none' },
  {
    kind: 'fork',
    run: () =>
      commands.captureChatForkSnapshot('chat-0', {
        chat: { ...created, message: history(2, 'fork') },
        sourcePatch: { folderId: folder.id },
        folder,
      }),
    bodies: 'fork',
  },
  { kind: 'reset', run: () => commands.captureChatResetSnapshot('char-0'), bodies: 'owner' },
  { kind: 'import', run: () => commands.captureChatImportSnapshot('char-0'), bodies: 'none' },
] as const

afterEach(() => {
  charactersResourceState.characters = []
  selectedCharID.set(-1)
})

describe('F03 organization capture scope', () => {
  it.skipIf(baseline)('keeps the live organization entrypoints off the full-state compatibility capture', () => {
    for (const file of [
      'src/lib/SideBars/SideChatList.svelte',
      'src/lib/Others/ChatList.svelte',
      'src/lib/ChatScreens/Chat.svelte',
      'src/ts/characters.ts',
    ]) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('currentChatStateSnapshot')
    }
    expect(readFileSync('src/ts/chatCommands.ts', 'utf8').match(/\bcurrentChatStateSnapshot\b/g)).toHaveLength(1)
  })

  for (const fixture of fixtures) {
    it.skipIf(!baseline)(`records the still-live broad ${fixture.name} capture before organization cutover`, () => {
      installFixture(fixture)
      const captured = withCloneInstrumentation(() => commands.currentChatStateSnapshot())
      reportBrowserWork('F03-organization', {
        ...fixture,
        kind: 'legacy-full',
        snapshotBytes: JSON.stringify(captured.result).length,
        messageCount: messageIds(captured.result).length,
        clones: captured.totalCloneCount,
        largestCloneBytes: captured.maxClonedSize,
      })
    })
    for (const capture of captures) {
      it.skipIf(baseline)(`${capture.kind} excludes unrelated ${fixture.name} histories`, () => {
        const owner = installFixture(fixture)
        const sibling = owner.chats[1]
        const messages = sibling.message
        const message = messages[0]
        const captured = withCloneInstrumentation(() => capture.run())
        expect(captured.result).not.toBeNull()
        const ids = messageIds(captured.result)
        const expectedIds =
          capture.bodies === 'owner'
            ? owner.chats.flatMap((chat) => chat.message.map((message) => message.chatId))
            : capture.bodies === 'target'
              ? owner.chats[0].message.map((message) => message.chatId)
              : capture.bodies === 'fork'
                ? history(2, 'fork').map((message) => message.chatId)
                : []
        expect([...new Set(ids)].sort()).toEqual(expectedIds.sort())
        const snapshotBytes = JSON.stringify(captured.result).length
        const budget = capture.bodies === 'owner' ? JSON.stringify(owner.chats).length + 2_048 : 4_096
        expect(snapshotBytes).toBeLessThanOrEqual(budget)
        expect(captured.maxClonedSize).toBeLessThanOrEqual(budget)
        expect(owner.chats[1]).toBe(sibling)
        expect(sibling.message).toBe(messages)
        expect(messages[0]).toBe(message)
        reportBrowserWork('F03-organization', {
          ...fixture,
          kind: capture.kind,
          snapshotBytes,
          messageCount: ids.length,
          clones: captured.totalCloneCount,
          largestCloneBytes: captured.maxClonedSize,
          budget,
        })
      })
    }
  }
})
