import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectedCharID } from '../stores.svelte'
import { withTestDatabaseWrite } from '../__tests__/resourceDatabaseState'
import { charactersResourceState, resetServerResourceState } from './resourceState.svelte'
import {
  hydrateSelectedCharacterShell,
  hydrateCharacterShell,
  clearCharacterShellHydrationState,
} from './characterShellHydration.svelte'
import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from './commands'
import type { character } from '../storage/database.svelte'

vi.mock('../storage/fastifyStorage', () => ({ getNodeServerProxyAuth: async () => 'overlap-test' }))
vi.mock('./chatMessageHydration.svelte', async (importActual) => ({
  ...(await importActual<typeof import('./chatMessageHydration.svelte')>()),
  hydrateActiveChat: vi.fn(),
  hydrateActiveCharacterLorebook: vi.fn(),
}))

afterEach(() => {
  clearCharacterShellHydrationState()
  clearCachedServerCommandRevision()
  vi.unstubAllGlobals()
})

describe('route and startup character hydration overlap', () => {
  it.each(['shell', 'route'] as const)(
    'shares detail with %s starting first and leaves both owners ready',
    async (first) => {
      withTestDatabaseWrite(() => {
        resetServerResourceState()
        charactersResourceState.status = 'ready'
        charactersResourceState.characters = [
          {
            __serverCharacterShell: true,
            chaId: 'char-a',
            name: 'Summary',
            chatPage: 0,
            chats: [{ id: 'chat-a', name: 'Chat', message: [] }],
            chatFolders: [],
          } as unknown as character,
        ]
        charactersResourceState.currentChar = 0
      })
      selectedCharID.set(0)
      setCachedServerCommandRevision(5)
      let resolve!: (response: Response) => void
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done
          }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const startShell = () => hydrateSelectedCharacterShell()
      const startRoute = () => hydrateCharacterShell('char-a', { minimumRevision: 5 })
      const one = first === 'shell' ? startShell() : startRoute()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const two = first === 'shell' ? startRoute() : startShell()
      for (let i = 0; i < 5; i++) await Promise.resolve()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      resolve(
        new Response(
          JSON.stringify({
            revision: 5,
            character: {
              chaId: 'char-a',
              name: 'Detail',
              chatPage: 0,
              chats: [{ id: 'chat-a', name: 'Chat', message: [] }],
              chatFolders: [],
              customscript: [],
              triggerscript: [],
              globalLore: [],
            },
          }),
        ),
      )
      const [a, b] = await Promise.all([one, two])
      expect(first === 'shell' ? a : b).toBe(true)
      expect(first === 'shell' ? b : a).toBe(true)
      expect(charactersResourceState.characters[0].name).toBe('Detail')
    },
  )
})
