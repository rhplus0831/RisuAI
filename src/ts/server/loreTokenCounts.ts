import { isLoreTokenCounts, type LoreTokenCounts } from '@risuai/protocol/lore-token-counts'
import { getNodeServerProxyAuth } from '../storage/fastifyStorage'

export async function fetchLoreTokenCounts(
  characterId: string,
  chatId: string,
  signal?: AbortSignal,
): Promise<LoreTokenCounts> {
  const response = await fetch(
    `/api/v1/chats/${encodeURIComponent(chatId)}/lore-token-counts?characterId=${encodeURIComponent(characterId)}`,
    { headers: { 'risu-auth': await getNodeServerProxyAuth() }, signal, cache: 'no-store' },
  )
  if (!response.ok) throw new Error('Lore token calculation failed')
  const result: unknown = await response.json()
  if (!isLoreTokenCounts(result) || result.characterId !== characterId || result.chatId !== chatId) {
    throw new Error('Invalid lore token count response')
  }
  return result
}
