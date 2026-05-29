import type { Chat, Database, character } from '../../../../src/ts/storage/database.svelte'
import type { MultiModal } from '../../../../src/ts/process/index.svelte'
import { getActiveModules, getModuleAssets } from './modules.js'
import type { AssetLookup } from './history.js'

/**
 * Phase 9 / slice 3a: build the non-empty {@link AssetLookup} the history walk
 * feeds image/asset bytes from. Two byte sources, split exactly as the slice
 * decided:
 *
 *  - **Inlay bytes** (`{{inlay/inlayed/inlayeddata::id}}`) live only in the
 *    browser's localForage `inlayStorage`; the server has no copy. The client
 *    ships them in the request body (`inlayAssets`), and `getInlay(id)` resolves
 *    from that payload. Mirrors `formatHistoryMessage.ts:102-129` (the data URI
 *    is whatever the browser stored, so its mime type is preserved verbatim).
 *  - **Asset bytes** (`{{asset_prompt::name}}` + the `icon` fallback) live in
 *    the server assets store (`data/assets/`). `getAsset` / `getCharIcon`
 *    resolve a char/module asset reference (or `currentChar.image`) to image
 *    bytes through the route-supplied {@link ResolveStoredAssetImage}, which
 *    reads the store. Like the browser's `readImage(asset[1])` path
 *    (`formatHistoryMessage.ts:154-180`) the bytes are always re-wrapped as a
 *    `data:image/png;base64,` URI regardless of the stored content-type.
 */

/** One inlay asset shipped on the `/generate/chat` request body. */
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
 * to image bytes, or `undefined` when it cannot be resolved. The route binds
 * this to the on-disk assets store; tests can supply a fake.
 */
export type ResolveStoredAssetImage = (reference: string) => MultiModal | undefined

function isMultiModalType(value: unknown): value is MultiModal['type'] {
  return value === 'image' || value === 'video' || value === 'audio' || value === 'signature'
}

/** Parse the validated (array-typed) request `inlayAssets` into an id → bytes map. */
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

/**
 * Build the {@link AssetLookup} bound to a single send. `getInlay` reads the
 * request payload; `getAsset` / `getCharIcon` read the server store. Returns the
 * empty-method default behavior (bytes drop) only when no resolver is supplied.
 */
export function buildAssetLookup(args: {
  database: Database
  currentChar: character
  currentChat: Chat
  inlayAssets: unknown
  resolveStoredAssetImage?: ResolveStoredAssetImage
}): AssetLookup {
  const inlays = parseRequestInlayAssets(args.inlayAssets)
  // Mirror `processAssetPrompts`' table (`history.ts:256`) so `getAsset(name)`
  // can map a name to its `asset[1]` reference; `processAssetPrompts` only calls
  // `getAsset` for names already present in this table.
  const moduleAssets = getModuleAssets(
    getActiveModules(args.database, args.currentChar, args.currentChat),
  )
  const assetTable = (args.currentChar.additionalAssets ?? []).concat(moduleAssets)
  const resolve = args.resolveStoredAssetImage
  return {
    getInlay: (id) => inlays.get(id),
    getAsset: (name) => {
      const asset = assetTable.find((entry) => entry[0] === name)
      return asset && resolve ? resolve(asset[1]) : undefined
    },
    getCharIcon: () => (resolve ? resolve(args.currentChar.image ?? '') : undefined),
  }
}
