import { getDatabase } from './database.svelte'
import { downloadFile } from '../globalApi.svelte'
import { alertNormal } from '../alert'
import { language } from 'src/lang'
import { ensureAllCharacterLorebooksHydrated, ensureAllChatsHydrated } from '../server/chatMessageHydration.svelte'

export async function exportAsDataset() {
  // Dataset export walks every character/chat, so bulk-hydrate chat messages and
  // stubbed character globalLore first.
  await ensureAllChatsHydrated({ strict: true })
  await ensureAllCharacterLorebooksHydrated({ strict: true })
  const db = getDatabase()

  let dataset = []
  for (const char of db.characters) {
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
}
