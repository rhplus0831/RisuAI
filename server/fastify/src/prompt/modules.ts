import type {
  Chat,
  Database,
  character,
  customscript,
} from '../../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../../src/ts/process/modules'
import type { triggerscript } from '../../../../src/ts/process/triggers'

/**
 * Server-side module helpers ported from `src/ts/process/modules.ts`. Resolves
 * active modules for an assembly call and exposes their regex script lists for
 * `processScript`.
 *
 * Ports the SPA's `lastModules` / `lastModuleData` memoization
 * (`modules.ts:400-426`) with server-safe keying (audit L1): an assembly
 * resolves active modules ~8× across its stages (slots, lorebook, history,
 * scripts, asset lookup, triggers) with identical inputs, so the scan +
 * dedupe is cached per loaded `Database` object. Keying the cache on the
 * database object (WeakMap) instead of the SPA's module-global string keeps
 * cross-request isolation: every request loads a fresh `Database`, so a new
 * request can never see a stale hit. The requested-id key and the
 * `database.modules` array reference both guard recomputation, so a
 * mid-assembly module toggle (chat/char/db id-list change) or wholesale
 * `modules` replacement invalidates the entry.
 *
 * Module fields not in scope here (their consumers ship in later
 * slices):
 *   - `module.lorebook` — needs Lorebook (7-7)
 *   - `module.cjs`      — browser-only plugin execution
 *
 * `module.regex` (7-6d), `module.assets` (7-5c), and `module.trigger`
 * (7-9a) are now resolved by the helpers below.
 */

function dedupeById(modules: RisuModule[]): RisuModule[] {
  const seen = new Set<string>()
  const out: RisuModule[] = []
  for (const m of modules) {
    if (!m || seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  return out
}

interface ActiveModulesMemoEntry {
  /** The requested-id inputs the cached result was computed from. */
  key: string
  /** The `database.modules` array the cached result was filtered from. */
  modulesRef: RisuModule[] | undefined
  result: RisuModule[]
}

const activeModulesMemo = new WeakMap<Database, ActiveModulesMemoEntry>()

export function getActiveModules(
  database: Database,
  currentChar: character | undefined,
  currentChat: Chat | undefined,
): RisuModule[] {
  let ids: string[] = [...(database.enabledModules ?? [])]
  if (currentChat?.modules) ids = ids.concat(currentChat.modules)
  if (currentChar?.modules) ids = ids.concat(currentChar.modules)
  if (database.moduleIntergration) {
    ids = ids.concat(
      database.moduleIntergration
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
  }
  if (ids.length === 0) return []

  // JSON keying (not the SPA's '-' join) — module ids are UUIDs containing '-'.
  const key = JSON.stringify(ids)
  const memo = activeModulesMemo.get(database)
  if (memo && memo.key === key && memo.modulesRef === database.modules) {
    return memo.result
  }

  const idSet = new Set(ids)
  const all = database.modules ?? []
  const matched = all.filter(
    (m) => m && (idSet.has(m.id) || (m.namespace ? idSet.has(m.namespace) : false)),
  )
  const result = dedupeById(matched)
  activeModulesMemo.set(database, { key, modulesRef: database.modules, result })
  return result
}

export function getModuleRegexScripts(modules: RisuModule[]): customscript[] {
  const out: customscript[] = []
  for (const m of modules) {
    if (!m?.regex) continue
    for (const r of m.regex) out.push(r)
  }
  return out
}

/**
 * Returns the active modules' `[name, id, type]` asset triples. Mirrors
 * `src/ts/process/modules.ts:421-433` `getModuleAssets()` for the prompt
 * leaf's `{{asset_prompt::…}}` resolution in 7-5c.
 */
export function getModuleAssets(modules: RisuModule[]): [string, string, string][] {
  const out: [string, string, string][] = []
  for (const m of modules) {
    if (!m?.assets) continue
    for (const a of m.assets) out.push(a)
  }
  return out
}

/**
 * Returns the active modules' trigger scripts with `lowLevelAccess`
 * inherited from the owning module. Mirrors
 * `src/ts/process/modules.ts:435-452` `getModuleTriggers()` for the
 * trigger runner (7-9a).
 *
 * Divergence from the SPA: the SPA mutates each trigger object in
 * place (`t.lowLevelAccess = module.lowLevelAccess`). The server runs
 * the chain once per assembly across requests, so we return shallow
 * clones (`{ ...t, lowLevelAccess }`) and never mutate the module's
 * own trigger objects.
 */
export function getModuleTriggers(modules: RisuModule[]): triggerscript[] {
  const out: triggerscript[] = []
  for (const m of modules) {
    if (!m?.trigger) continue
    for (const t of m.trigger) out.push({ ...t, lowLevelAccess: m.lowLevelAccess })
  }
  return out
}
