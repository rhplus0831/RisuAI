import { afterEach, describe, expect, it } from 'vitest'
import { withCloneInstrumentation, seedCloneCostDb } from './__tests__/cloneCostHarness'
import { reportBrowserWork } from './__tests__/browserWorkProbe'
import { currentChatStateSnapshot, restoreChatFolderRowMetadata } from './chatCommands'
import { charactersResourceState } from './server/resourceState.svelte'
import { selectedCharID } from './stores.svelte'

const fixtures = [
  { name: 'small', unrelatedCharacters: 1, unrelatedMessagesPerCharacter: 2 },
  { name: 'intermediate', unrelatedCharacters: 8, unrelatedMessagesPerCharacter: 100 },
  { name: 'large', unrelatedCharacters: 32, unrelatedMessagesPerCharacter: 1_000 },
]

afterEach(() => {
  charactersResourceState.characters = []
  selectedCharID.set(-1)
})

describe('F03 sidebar snapshot work probe', () => {
  for (const fixture of fixtures) {
    it(`records ${fixture.name} resident-history scope and preserves unrelated generation on folder rollback`, () => {
      const seed = seedCloneCostDb({
        characterCount: fixture.unrelatedCharacters + 1,
        hydratedMessageCount: 2,
        messageBodySize: 256,
      })
      seed.characters[0]!.chatFolders = [{ id: 'target-folder', name: 'Target', folded: false }]
      for (let index = 1; index < seed.characters.length; index += 1) {
        seed.characters[index]!.chats[0]!.message = Array.from(
          { length: fixture.unrelatedMessagesPerCharacter },
          (_, messageIndex) => ({
            role: 'char' as const,
            data: 'x'.repeat(256),
            chatId: `unrelated-${index}-${messageIndex}`,
          }),
        )
      }
      charactersResourceState.characters = seed.characters
      charactersResourceState.status = 'ready'
      selectedCharID.set(0)
      const unrelatedCharacter = charactersResourceState.characters[1]!
      const unrelatedMessage = unrelatedCharacter.chats[0]!.message[0]!
      const snapshot = withCloneInstrumentation(() => currentChatStateSnapshot())
      expect(charactersResourceState.characters[1]).toBe(unrelatedCharacter)
      expect(unrelatedCharacter.chats[0]!.message[0]).toBe(unrelatedMessage)
      const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot.result)).byteLength

      const folder = charactersResourceState.characters[0]!.chatFolders![0]!
      const rollback = {
        selectedCharID: 0,
        characterId: 'char-0',
        folderId: folder.id,
        metadata: { folded: false },
        attempted: { folded: true },
      }
      folder.folded = true
      unrelatedMessage.data = 'background generation continued'
      const restored = withCloneInstrumentation(() => restoreChatFolderRowMetadata(rollback), {
        countJsonStringify: ({ stack }) => stack.includes('cloneJsonValue'),
      })
      expect(charactersResourceState.characters[0]!.chatFolders![0]!.folded).toBe(false)
      expect(charactersResourceState.characters[1]).toBe(unrelatedCharacter)
      expect(unrelatedCharacter.chats[0]!.message[0]).toBe(unrelatedMessage)
      expect(unrelatedMessage.data).toBe('background generation continued')

      // An older failed operation must not restore over a newer field value.
      charactersResourceState.characters[0]!.chatFolders![0]!.folded = false
      restoreChatFolderRowMetadata({ ...rollback, metadata: { folded: true } })
      expect(charactersResourceState.characters[0]!.chatFolders![0]!.folded).toBe(false)

      reportBrowserWork('F03', {
        ...fixture,
        targetMessages: 2,
        messageBodyBytes: 256,
        snapshotApi: 'currentChatStateSnapshot',
        rollbackApi: 'restoreChatFolderRowMetadata',
        snapshotBytes,
        snapshotCloneCount: snapshot.totalCloneCount,
        largestCloneBytes: snapshot.maxClonedSize,
        capturedCharacterCount: snapshot.result.characters.length,
        capturedMessageCount: snapshot.result.characters.reduce(
          (total, character) => total + character.chats.reduce((count, chat) => count + chat.message.length, 0),
          0,
        ),
        folderRollbackCloneCount: restored.totalCloneCount,
        folderRollbackLargestCloneBytes: restored.maxClonedSize,
        unrelatedMessageIdentityPreserved: true,
      })
    })
  }
})
