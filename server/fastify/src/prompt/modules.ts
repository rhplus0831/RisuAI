import type { Chat, Database, character } from '../../../../src/ts/storage/database.svelte'
import type { ServerTriggerScript as triggerscript } from './triggerDescriptors.js'
import type {
  ServerModule as RisuModule,
  ServerModuleLorebook as loreBook,
  ServerModuleRegexScript as customscript,
} from './moduleDescriptors.js'
import {
  hasModuleActivationIdentifiers,
  moduleActivationIdentifiersKey,
  resolveActiveModuleIdentifiers,
  resolveModuleActivationStates,
} from '../../../../src/ts/moduleActivation.js'
import { attachTriggerSource } from './triggerSource.js'

/**
 * Server-side module helpers ported from `src/ts/process/modules.ts`. Resolves
 * active modules for an assembly call and exposes their regex script lists for
 * `processScript`.
 *
 * Ports the SPA's `lastModules` / `lastModuleData` memoization
 * (`modules.ts`) with server-safe keying an assembly
 * resolves active modules ~8× across its stages (slots, lorebook, history,
 * scripts, asset lookup, triggers) with identical inputs, so the scan +
 * dedupe is cached per loaded `Database` object. Keying the cache on the
 * database object (WeakMap) instead of the SPA's module-global string keeps
 * cross-request isolation: every request loads a fresh `Database`, so a new
 * request can never see a stale hit. The activation-identifier key and the
 * `database.modules` array reference both guard recomputation, so a
 * mid-assembly module toggle (chat/char/db id-list change) or wholesale
 * `modules` replacement invalidates the entry.
 *
 * Module fields not resolved here:
 *   - `module.lorebook` — handled by lorebook activation and exposed through
 *     `getModuleLorebooks` for Lua's exact-comment preset lookup
 *   - `module.cjs`      — browser-only plugin execution
 *
 * `module.regex`, `module.assets`, and `module.trigger` are resolved by the
 * helpers below.
 */

interface ActiveModulesMemoEntry {
  /** The activation identifiers the cached result was computed from. */
  key: string
  /** The `database.modules` array the cached result was filtered from. */
  modulesRef: RisuModule[] | undefined
  result: RisuModule[]
}

const activeModulesMemo = new WeakMap<Database, ActiveModulesMemoEntry>()

/** Stable result for the no-active-modules case so downstream memos get a
 *  reference-equal value instead of a fresh `[]` per call. Read-only by
 *  contract — every consumer only iterates it. */
const NO_ACTIVE_MODULES: RisuModule[] = []

export function getActiveModules(
  database: Database,
  currentChar: character | undefined,
  currentChat: Chat | undefined,
): RisuModule[] {
  const activationIdentifiers = resolveActiveModuleIdentifiers(database, currentChar, currentChat)
  if (!hasModuleActivationIdentifiers(activationIdentifiers)) return NO_ACTIVE_MODULES

  const key = moduleActivationIdentifiersKey(activationIdentifiers)
  const memo = activeModulesMemo.get(database)
  if (memo && memo.key === key && memo.modulesRef === database.modules) {
    return memo.result
  }

  const result = resolveModuleActivationStates({
    modules: database.modules ?? [],
    identifiers: activationIdentifiers,
  }).map((state) => state.module)
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

export function getModuleLorebooks(modules: RisuModule[]): loreBook[] {
  const out: loreBook[] = []
  for (const m of modules) {
    if (!m?.lorebook) continue
    for (const entry of m.lorebook) out.push(entry)
  }
  return out
}

/**
 * Returns the active modules' `[name, id, type]` asset triples. Mirrors
 * `src/ts/process/modules.ts` `getModuleAssets()` for the prompt
 * leaf's `{{asset_prompt::…}}` resolution.
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
 * `src/ts/process/modules.ts` `getModuleTriggers()` for the
 * trigger runner.
 *
 * Like the SPA's current `getModuleTriggers`, this returns shallow clones
 * (`{ ...t, lowLevelAccess }`) and never mutates the module's own trigger
 * objects. The server also attaches source metadata for diagnostics.
 */
export function getModuleTriggers(modules: RisuModule[]): triggerscript[] {
  const out: triggerscript[] = []
  for (const m of modules) {
    if (!m?.trigger) continue
    for (let index = 0; index < m.trigger.length; index++) {
      const t = m.trigger[index]
      const lowLevelAccess = m.lowLevelAccess ?? false
      const clone = { ...t, lowLevelAccess }
      out.push(
        attachTriggerSource(clone, {
          ownerType: 'module',
          ownerId: m.id,
          ownerName: m.name,
          triggerId: (t as { id?: string }).id,
          triggerIndex: index,
          triggerComment: t.comment,
          triggerType: t.type,
          lowLevelAccess,
        }),
      )
    }
  }
  return out
}
