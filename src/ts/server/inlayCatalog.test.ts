import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyServerInlayCatalogResource,
  findServerInlayCatalogEntry,
  getServerInlayCatalogResource,
  resetServerInlayCatalogResource,
  subscribeServerInlayCatalog,
  isServerInlayCatalogPayload,
} from './inlayCatalog'

const ASSET_ID = 'a'.repeat(64)
const entry = {
  assetId: ASSET_ID,
  aliases: ['friendly-id'],
  ext: 'png',
  height: 3,
  name: 'shared.png',
  size: 12,
  type: 'image' as const,
  width: 4,
}

beforeEach(() => {
  resetServerInlayCatalogResource()
})

describe('server inlay catalog resource', () => {
  it('indexes an authoritative catalog response', () => {
    expect(applyServerInlayCatalogResource({ revision: 7, assets: [entry] })).toBe(true)
    expect(findServerInlayCatalogEntry('friendly-id')).toEqual(entry)
  })

  it('notifies mounted consumers and force-applies a lower restored revision', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeServerInlayCatalog(listener)
    applyServerInlayCatalogResource({ revision: 9, assets: [entry] })
    expect(applyServerInlayCatalogResource({ revision: 3, assets: [] })).toBe(false)
    expect(applyServerInlayCatalogResource({ revision: 3, assets: [] }, { force: true })).toBe(true)

    expect(listener).toHaveBeenCalledTimes(2)
    expect(getServerInlayCatalogResource()).toEqual({ revision: 3, assets: [] })
    unsubscribe()
  })

  it('rejects malformed catalog envelopes', () => {
    expect(isServerInlayCatalogPayload({ revision: 1, assets: [{ ...entry, size: -1 }] })).toBe(false)
  })
})
