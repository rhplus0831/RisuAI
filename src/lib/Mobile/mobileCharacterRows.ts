import { getCharacterDisplayInfo } from 'src/ts/characterDisplayName'
import type { character } from 'src/ts/storage/database.svelte'

export interface MobileCharacterRow {
  chaId?: string
  image?: string
  chats: number
  index: number
  interaction: number
  name: string
  searchText: string
  agoText: string
  sortedIndex: number
}

export interface MobileCharacterRowsOptions {
  hideTrash?: boolean
  agoFormatter: Pick<Intl.RelativeTimeFormat, 'format'>
  unknownText: string
  now?: number
}

type MobileCharacterSummary = character & {
  chatCount?: number
  activeChatId?: string | null
}

const relativeTimeLocaleByUiLanguage: Readonly<Record<string, string>> = {
  cn: 'zh-CN',
  de: 'de',
  en: 'en',
  es: 'es',
  ko: 'ko',
  vi: 'vi',
  'zh-Hant': 'zh-TW',
}

export function resolveMobileRelativeTimeLocale(uiLanguage: unknown): string {
  if (typeof uiLanguage !== 'string') return 'en'
  return relativeTimeLocaleByUiLanguage[uiLanguage] ?? 'en'
}

export function normalizeMobileCharacterSearch(value: string) {
  return value.replace(/ /g, '').toLocaleLowerCase()
}

export function makeMobileCharacterAgoText(
  time: number,
  agoFormatter: Pick<Intl.RelativeTimeFormat, 'format'>,
  unknownText: string,
  now = Date.now(),
) {
  if (time === 0) {
    return unknownText
  }
  const diff = now - time
  if (diff < 3600000) {
    const min = Math.floor(diff / 60000)
    return agoFormatter.format(-min, 'minute')
  }
  if (diff < 86400000) {
    const hour = Math.floor(diff / 3600000)
    return agoFormatter.format(-hour, 'hour')
  }
  if (diff < 604800000) {
    const day = Math.floor(diff / 86400000)
    return agoFormatter.format(-day, 'day')
  }
  if (diff < 2592000000) {
    const week = Math.floor(diff / 604800000)
    return agoFormatter.format(-week, 'week')
  }
  if (diff < 31536000000) {
    const month = Math.floor(diff / 2592000000)
    return agoFormatter.format(-month, 'month')
  }
  const year = Math.floor(diff / 31536000000)
  return agoFormatter.format(-year, 'year')
}

export function formatMobileCharacterRows(
  characters: readonly MobileCharacterSummary[],
  { hideTrash = false, agoFormatter, unknownText, now = Date.now() }: MobileCharacterRowsOptions,
): MobileCharacterRow[] {
  const rows = characters
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !hideTrash || !c.trashTime)
    .map(({ c, i }) => {
      const interaction = c.lastInteraction || 0
      const displayInfo = getCharacterDisplayInfo(c)
      return {
        chaId: c.chaId,
        name: displayInfo.name,
        searchText: displayInfo.searchText,
        image: c.image,
        chats: c.chatCount ?? c.chats.length,
        index: i,
        interaction,
        agoText: makeMobileCharacterAgoText(interaction, agoFormatter, unknownText, now),
        sortedIndex: 0,
      }
    })
    .sort((a, b) => {
      if (a.interaction === b.interaction) {
        return a.name.localeCompare(b.name)
      }
      return b.interaction - a.interaction
    })

  for (let sortedIndex = 0; sortedIndex < rows.length; sortedIndex++) {
    rows[sortedIndex].sortedIndex = sortedIndex
  }

  return rows
}

export function filterMobileCharacterRows(rows: readonly MobileCharacterRow[], normalizedSearch: string) {
  return rows.filter((char) => normalizeMobileCharacterSearch(char.searchText).includes(normalizedSearch))
}

export function mobileCharacterRowKey(char: MobileCharacterRow) {
  return char.chaId || `legacy-${char.index}`
}
