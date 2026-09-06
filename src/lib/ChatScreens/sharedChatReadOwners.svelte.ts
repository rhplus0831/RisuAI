import { charactersResourceState } from 'src/ts/server/resourceState.svelte'
import { getChatMessageOwnerState } from 'src/ts/server/chatMessageHydration.svelte'
import { createChatReadOwners } from './chatReadOwners.svelte'

// Shared by transcript rows and their parser/cache readers, including remounts.
export const sharedChatReadOwners = createChatReadOwners(
  charactersResourceState,
  (chatId) => getChatMessageOwnerState(chatId)?.messages,
)
