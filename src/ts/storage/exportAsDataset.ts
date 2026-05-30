import { getDatabase } from './database.svelte'
import { downloadFile } from '../globalApi.svelte'
import { alertNormal } from '../alert'
import { language } from 'src/lang'
import {
  ensureAllCharacterLorebooksHydrated,
  ensureAllChatsHydrated,
} from '../server/chatMessageHydration.svelte'

export async function exportAsDataset() {
  // Phase 4.3 / 5: chats and (when stubbed) character globalLore are lazy-hydrated
  // on open; this walks every character, so load all of both first.
  await ensureAllChatsHydrated()
  await ensureAllCharacterLorebooksHydrated()
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
