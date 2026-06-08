export interface SupporterBuckets {
  I: string[]
  II: string[]
  III: string[]
  IV: string[]
  V: string[]
}

export interface SupporterListEntry {
  amount: number
  name: string
}

export const SUPPORTER_ENDPOINT = 'https://sv.risuai.xyz/patreon/list'

let supporterCache: Promise<SupporterBuckets> | null = null

export function createEmptySupporterBuckets(): SupporterBuckets {
  return {
    I: [],
    II: [],
    III: [],
    IV: [],
    V: [],
  }
}

export function bucketSupporters(list: readonly SupporterListEntry[]): SupporterBuckets {
  const buckets = createEmptySupporterBuckets()

  for (const supporter of list) {
    if (!supporter.name) continue

    if (supporter.amount >= 50) {
      buckets.V.push(supporter.name)
    } else if (supporter.amount >= 20) {
      buckets.IV.push(supporter.name)
    } else if (supporter.amount >= 10) {
      buckets.III.push(supporter.name)
    } else if (supporter.amount >= 5) {
      buckets.II.push(supporter.name)
    } else {
      buckets.I.push(supporter.name)
    }
  }

  return buckets
}

export function loadSupporters() {
  if (!supporterCache) {
    supporterCache = fetchSupporters().catch((error) => {
      supporterCache = null
      throw error
    })
  }

  return supporterCache
}

async function fetchSupporters() {
  const supp = await fetch(SUPPORTER_ENDPOINT)
  if (!supp.ok) {
    throw new Error(`Failed to load supporters (${supp.status})`)
  }

  const list = (await supp.json()) as SupporterListEntry[]
  return bucketSupporters(list)
}
