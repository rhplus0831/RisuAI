import { getDatabase } from './database.svelte'
import { downloadFile } from '../globalApi.svelte'
import { alertNormal } from '../alert'
import { language } from 'src/lang'
import { ensureAllChatsHydrated } from '../server/chatMessageHydration.svelte'

export async function exportAsDataset() {
  // Phase 4.3: chats are lazy-hydrated on open; this exports every chat's
  // history, so make sure all chats' messages are loaded first.
  await ensureAllChatsHydrated()
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
