import { downloadFile } from '../globalApi.svelte'
import { alertError, alertNormal } from '../alert'
import { language } from 'src/lang'
import { ensureAllCharacterLorebooksHydrated, ensureAllChatsHydrated } from '../server/chatMessageHydration.svelte'
import { charactersResourceState } from '../server/resourceState.svelte'

export async function exportAsDataset(): Promise<boolean> {
  try {
    // Dataset export walks every character/chat, so bulk-hydrate chat messages and
    // stubbed character globalLore first.
    await ensureAllChatsHydrated({ strict: true })
    await ensureAllCharacterLorebooksHydrated({ strict: true })
    const dataset = []
    for (const char of charactersResourceState.characters) {
      for (const chat of char.chats) {
        dataset.push({
          name: char.name,
          description: char.desc,
          chats: chat.message,
          lorebook: char.globalLore,
        })
      }
    }

    await downloadFile('dataset.json', Buffer.from(JSON.stringify(dataset, null, 4), 'utf-8'))

    alertNormal(language.successExport)
    return true
  } catch (error) {
    alertError(error)
    return false
  }
}
