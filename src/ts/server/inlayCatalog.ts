export type ServerInlayCatalogAssetType = 'image' | 'video' | 'audio' | 'signature'

export interface ServerInlayCatalogEntry {
  assetId: string
  aliases: string[]
  ext: string
  height?: number
  name: string
  size: number
  type: ServerInlayCatalogAssetType
  width?: number
}

export interface ServerInlayCatalogResourcePayload {
  revision: number
  assets: ServerInlayCatalogEntry[]
}

let resource: ServerInlayCatalogResourcePayload | null = null
const listeners = new Set<(resource: ServerInlayCatalogResourcePayload) => void>()

export function getServerInlayCatalogResource(): ServerInlayCatalogResourcePayload | null {
  return resource
    ? {
        revision: resource.revision,
        assets: resource.assets.map(cloneEntry),
      }
    : null
}

export function applyServerInlayCatalogResource(
  next: ServerInlayCatalogResourcePayload,
  options: { force?: boolean } = {},
): boolean {
  if (!isServerInlayCatalogPayload(next)) return false
  if (!options.force && resource && next.revision < resource.revision) return false
  resource = {
    revision: next.revision,
    assets: next.assets.map(cloneEntry),
  }
  for (const listener of listeners) listener(getServerInlayCatalogResource()!)
  return true
}

export function resetServerInlayCatalogResource(): void {
  resource = null
}

export function subscribeServerInlayCatalog(
  listener: (resource: ServerInlayCatalogResourcePayload) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function findServerInlayCatalogEntry(id: string): ServerInlayCatalogEntry | null {
  const entry = resource?.assets.find((candidate) => candidate.assetId === id || candidate.aliases.includes(id))
  return entry ? cloneEntry(entry) : null
}

export function applyServerInlayCatalogEntryReceipt(entry: ServerInlayCatalogEntry, revision: number): boolean {
  if (!resource || revision <= resource.revision || !isServerInlayCatalogEntry(entry)) return false
  const assets = resource.assets.filter((candidate) => candidate.assetId !== entry.assetId)
  assets.push(cloneEntry(entry))
  return applyServerInlayCatalogResource({ revision, assets })
}

export function applyServerInlayCatalogDeletionReceipt(assetId: string, revision: number): boolean {
  if (!resource || revision <= resource.revision) return false
  return applyServerInlayCatalogResource({
    revision,
    assets: resource.assets.filter((candidate) => candidate.assetId !== assetId),
  })
}

function cloneEntry(entry: ServerInlayCatalogEntry): ServerInlayCatalogEntry {
  return { ...entry, aliases: [...entry.aliases] }
}

export function isServerInlayCatalogPayload(value: unknown): value is ServerInlayCatalogResourcePayload {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false
  return Array.isArray(value.assets) && value.assets.every(isServerInlayCatalogEntry)
}

function isServerInlayCatalogEntry(value: unknown): value is ServerInlayCatalogEntry {
  if (!isRecord(value)) return false
  if (typeof value.assetId !== 'string' || !/^[a-f0-9]{64}$/.test(value.assetId)) return false
  if (typeof value.name !== 'string' || value.name.length === 0) return false
  if (typeof value.ext !== 'string' || value.ext.length === 0) return false
  if (!Number.isSafeInteger(value.size) || (value.size as number) < 0) return false
  if (!['image', 'video', 'audio', 'signature'].includes(value.type as string)) return false
  if (!Array.isArray(value.aliases) || !value.aliases.every((alias) => typeof alias === 'string')) return false
  if (value.width !== undefined && (!Number.isSafeInteger(value.width) || (value.width as number) <= 0)) return false
  if (value.height !== undefined && (!Number.isSafeInteger(value.height) || (value.height as number) <= 0)) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
