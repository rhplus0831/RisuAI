# Reference: Stub / Hydration Model

Date: 2026-05-30

Backs Phases 4–5. What is stubbed, what stays resident, how hydration works, and
the live landmine (`lorebookBridge`).

## Why stubbing is feasible here (and not for settings)

- `DBState.db` is one flat object read ~1,648× across ~182 files, synchronously.
  Settings fields (`aiModel`, `language`, ...) are read all over the chat/render
  path → stubbing them is the worst case.
- Chats/messages/lorebooks are the heavy data **and** have an explicit load point
  (open chat / open character / open module). Most character reads are point
  lookups (`characters.find(c => c.chaId === id)`), which fit stub→hydrate.
- Server-side prompt assembly already removed the *generation-time* need for full
  client data — the server reads the full corpus itself. The client needs full
  data only to **render the open chat** and to **edit** an entity.

## Scope (locked)

Stub **only**: chats/messages (+ their `localLore`, `hypaV3Data`), character
`globalLore`, module `lorebook`. Everything else stays fully projected.

## Resident vs hydrate tiers

| Tier | Contents | Loaded |
| ---- | -------- | ------ |
| Always resident (bootstrap) | settings; character stubs; module stubs; **enabled modules' display parts** (`lorebook` + `regex`); selected character + open chat | startup |
| Hydrate on chat-open | that chat's `message[]` (from SQLite), `localLore`, `hypaV3Data` | chat-open |
| Hydrate on character-open | `globalLore`, scripts, `emotionImages` | character-open |
| Hydrate on module open / enable | module `lorebook`, `regex`, `trigger`, `cjs` | open in editor, or when enabled |

**Enabled modules stay resident** because `getModuleLorebooks()` /
`getModuleRegexScripts()` iterate `db.enabledModules`
(`src/ts/process/modules.ts:418,440,487`) during synchronous message rendering /
CBS, which cannot await hydration. Disabled modules are fully stubbed.

## Hydration mechanics

- Served from the Phase 2 **targeted per-resource fetch** primitive (server has
  everything in memory + the messages table).
- Merged into `DBState.db` through `withTrustedServerProjectionWrite` (the
  projection proxy is read-only).
- Must not be clobbered by the SSE refresh — that is exactly what Phase 2's
  echo-skip guarantees.
- The integrity/normalization pass (`src/ts/bootstrap.ts:242`) that defaults
  `v.chats`/`v.globalLore`/`v.customscript` must split into stub-level vs
  hydration-level defaults.

## The live landmine: `lorebookBridge`

`src/ts/server/lorebookBridge.svelte.ts` walks the whole corpus today:
- entry-id assignment over all chars' `globalLore` + all chats' `localLore` + all
  modules' `lorebook` (`:89-97`),
- a snapshot/diff map over the same (`:371-379`),
- find-chat-by-id across all characters (`:421-424`).

Unlike the dead asset GC (Phase 1, callerless `cleanChunks`), this is **live**.
Stubbing breaks it unless it is reworked to operate per-entity on hydration. This
rework is the bulk of Phase 5 (and the `localLore` part touches Phase 4).

## Synchronous cross-entity reads to respect

- CBS `{{lorebook}}` reads `achara.globalLore` for a possibly-passed character
  (`src/ts/cbs.ts:353`). Group chat is removed, so this is almost always the
  selected (hydrated) char — confirm no live path passes a non-hydrated one.
- Enabled-module reads (above). Both define the resident set; render cannot await.
