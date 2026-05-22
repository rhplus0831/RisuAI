import type {
  Chat,
  Database,
  character,
  customscript,
} from '../../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../../src/ts/process/modules'

/**
 * Phase 7-6d server-side helpers ported from
 * `src/ts/process/modules.ts:357-466`. Resolves the active modules
 * for an assembly call and exposes their regex script lists for
 * `processScript`.
 *
 * Skips the SPA's `lastModules` / `lastModuleData` memoization
 * (`modules.ts:379-403`): the server runs the chain once per
 * assembly so the cache adds no value and would only complicate
 * cross-request isolation.
 *
 * Module fields not in scope here (their consumers ship in later
 * slices):
 *   - `module.trigger`  — needs Triggers (7-9)
 *   - `module.lorebook` — needs Lorebook (7-7)
 *   - `module.assets`   — needs the multimodal/asset_prompt path (7-5c)
 *   - `module.cjs`      — browser-only plugin execution
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
  const idSet = new Set(ids)
  const all = database.modules ?? []
  const matched = all.filter(
    (m) => m && (idSet.has(m.id) || (m.namespace ? idSet.has(m.namespace) : false)),
  )
  return dedupeById(matched)
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
