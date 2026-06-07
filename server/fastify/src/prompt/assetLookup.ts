import type { Chat, Database, character } from '../../../../src/ts/storage/database.svelte'
import type { MultiModal } from '../../../../src/ts/process/index.svelte'
import { getActiveModules, getModuleAssets } from './modules.js'
import type { AssetLookup } from './history.js'

/**
 * Build the non-empty {@link AssetLookup} that feeds image/asset bytes into the
 * history walk. It has two byte sources:
 *
 *  - **Inlay bytes** (`{{inlay/inlayed/inlayeddata::id}}`) live in the server
 *    assets store in Fastify mode. New inlay ids are asset ids directly; old
 *    browser-local ids can be mapped through request `inlayAssetRefs`.
 *  - **Asset bytes** (`{{asset_prompt::name}}` + the `icon` fallback) live in
 *    the server assets store (`data/assets/`). `getAsset` / `getCharIcon`
 *    resolve a char/module asset reference (or `currentChar.image`) to image
 *    bytes through the route-supplied {@link ResolveStoredAsset}, which
 *    reads the store. Like the browser's `readImage(asset[1])` path
 *    (`formatHistoryMessage.ts:154-180`) the bytes are always re-wrapped as a
 *    `data:image/png;base64,` URI regardless of the stored content-type.
 */

/** Legacy compatibility shape for old `/generate/chat` request-body inlay bytes. */
export interface RequestInlayAsset {
  /** The inlay id captured from `{{inlay/inlayed/inlayeddata::id}}`. */
  id: string
  type: MultiModal['type']
  /** A base64 data URI (`data:<mime>;base64,…`), as the browser stored it. */
  base64: string
  width?: number
  height?: number
}

/**
 * Resolve a stored-asset reference (a sha256 id or an `assets/<id>.<ext>` path)
 * to multimodal bytes, or `undefined` when it cannot be resolved. The route binds
 * this to the on-disk assets store; tests can supply a fake.
 */
export type StoredAssetPurpose = 'asset_prompt' | 'inlay'
export type ResolveStoredAsset = (
  reference: string,
  purpose: StoredAssetPurpose,
) => Promise<MultiModal | undefined>

function isMultiModalType(value: unknown): value is MultiModal['type'] {
  return value === 'image' || value === 'video' || value === 'audio' || value === 'signature'
}

/** Parse legacy request `inlayAssets` into an id → bytes map. */
export function parseRequestInlayAssets(raw: unknown): Map<string, MultiModal> {
  const map = new Map<string, MultiModal>()
  if (!Array.isArray(raw)) return map
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = record.id
    const base64 = record.base64
    if (typeof id !== 'string' || id.length === 0 || typeof base64 !== 'string') continue
    if (!isMultiModalType(record.type)) continue
    const multimodal: MultiModal = { type: record.type, base64 }
    if (typeof record.width === 'number') multimodal.width = record.width
    if (typeof record.height === 'number') multimodal.height = record.height
    map.set(id, multimodal)
  }
  return map
}

/** Parse request `inlayAssetRefs` into legacy inlay id → server asset id aliases. */
export function parseRequestInlayAssetRefs(
  raw: unknown,
): Map<string, { assetId: string; width?: number; height?: number }> {
  const map = new Map<string, { assetId: string; width?: number; height?: number }>()
  if (!Array.isArray(raw)) return map
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.length === 0) continue
    if (typeof record.assetId !== 'string' || record.assetId.length === 0) continue
    map.set(record.id, {
      assetId: record.assetId,
      ...(typeof record.width === 'number' ? { width: record.width } : {}),
      ...(typeof record.height === 'number' ? { height: record.height } : {}),
    })
  }
  return map
}

/**
 * Build the {@link AssetLookup} bound to a single send. `getInlay` reads the
 * server store; `getAsset` / `getCharIcon` read the server store. Returns the
 * empty-method default behavior (bytes drop) only when no resolver is supplied.
 */
export function buildAssetLookup(args: {
  database: Database
  currentChar: character
  currentChat: Chat
  inlayAssets: unknown
  inlayAssetRefs?: unknown
  resolveStoredAsset?: ResolveStoredAsset
}): AssetLookup {
  const requestInlays = parseRequestInlayAssets(args.inlayAssets)
  const requestInlayRefs = parseRequestInlayAssetRefs(args.inlayAssetRefs)
  // Mirror `processAssetPrompts`' table (`history.ts:256`) so `getAsset(name)`
  // can map a name to its `asset[1]` reference; `processAssetPrompts` only calls
  // `getAsset` for names already present in this table.
  const moduleAssets = getModuleAssets(
    getActiveModules(args.database, args.currentChar, args.currentChat),
  )
  const assetTable = (args.currentChar.additionalAssets ?? []).concat(moduleAssets)
  const resolve = args.resolveStoredAsset
  return {
    getInlay: async (id) => {
      const ref = requestInlayRefs.get(id)
      const resolved = resolve
        ? ((await resolve(ref?.assetId ?? id, 'inlay')) ?? requestInlays.get(id))
        : requestInlays.get(id)
      if (!resolved || !ref) return resolved
      return {
        ...resolved,
        ...(typeof ref.width === 'number' ? { width: ref.width } : {}),
        ...(typeof ref.height === 'number' ? { height: ref.height } : {}),
      }
    },
    getAsset: async (name) => {
      const asset = assetTable.find((entry) => entry[0] === name)
      return asset && resolve ? await resolve(asset[1], 'asset_prompt') : undefined
    },
    getCharIcon: async () =>
      resolve ? await resolve(args.currentChar.image ?? '', 'asset_prompt') : undefined,
  }
}
