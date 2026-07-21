import { getDatabase } from './storage/database.svelte'
import { getFileSrc } from './fileSource'

export async function getCharImage(loc: string, type: 'plain' | 'css' | 'contain' | 'lgcss') {
  const db = getDatabase()

  // Return placeholder when hideAllImages is enabled
  if (db.hideAllImages) {
    if (type === 'plain') {
      return '/none.webp'
    }
    return '' // For CSS types, return empty to show default ? icon
  }

  if (!loc || loc === '') {
    if (type === 'css') {
      return ''
    }
    return null
  }
  const filesrc = await getFileSrc(loc)
  if (type === 'plain') {
    return filesrc
  } else if (type === 'css') {
    return `background: url("${filesrc}");background-size: cover;`
  } else if (type === 'lgcss') {
    return `background: url("${filesrc}");background-size: cover;height: 10.66rem;`
  } else {
    return `background: url("${filesrc}");background-size: contain;background-repeat: no-repeat;background-position: center;`
  }
}
