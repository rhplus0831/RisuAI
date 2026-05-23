# Phase 7 - Server-Side Prompt Assembly

Date: 2026-05-23

Status: in-progress (15 slices landed as of 2026-05-23).
`variables.ts`, `staticSections.ts`, `plainSections.ts`,
`history.ts` (through multimodal inlays + `{{asset_prompt::}}`),
`scripts.ts` (regex chain through module regex), `modules.ts`
(`getActiveModules`, `getModuleRegexScripts`, `getModuleAssets`),
and `lorebook.ts` (constant + keyword activation with
`searchMatch`, child mirror, conditional-activation decorators,
`matchLog`, `inject_lore` rewrites) are real. The remaining assembly modules
under `server/fastify/src/prompt/` (`assemble`, `templates`,
`tokens`, `triggers`) are still throwing stubs. See
[Remaining roadmap](#remaining-roadmap) below for the tiered slice
plan, and [`ROADMAP.md`](../../../ROADMAP.md) for the strategic
ordering of the remaining slices.
[`HANDOVER.md`](../../../HANDOVER.md) is the working entry point for
picking up Phase 7.

## Goal

Move Stage 2 (prompt assembly, lorebook activation, persona /
description / author note injection, tokenizer-driven budget
pruning) behind a single Fastify route. The browser stops walking
the preset template; it sends intent and gets back the assembled
OpenAI-shaped payload (or a streamed completion that uses it).

## Preconditions

- Phase 2 closed (server holds presets, lorebooks, personas,
  characters).
- Phase 6 closed (server can dispatch the assembled payload).

## Scope

### Routes

- `POST /api/v1/generate/chat` - high-level intent endpoint.
  Inputs:

  ```jsonc
  {
    "chatId": "...",
    "characterId": "...",
    "presetId": "...",         // optional; defaults to active
    "loadoutId": "...",        // optional
    "mode": "send" | "continue" | "preview" | "preview_prompt"
            | "regenerate",
    "regenerateMessageId": "...",  // when mode === "regenerate"
    "userMessage": "...",          // when mode === "send"
    "resetMessages": true,         // when starting a fresh chat
    "expectedRevision": 1234,
    "inlayAssets": [...],          // browser-uploaded blobs
    "clientCapabilities": {
      "sseEvents": ["stage", "prompt", "info", "token",
                    "message_patch", "side_effect",
                    "warning", "error", "done"]
    }
  }
  ```

  Output: SSE stream with the event types listed above.

- `POST /api/v1/generate/preview-prompt` - shorthand for the
  `preview_prompt` mode. Returns the assembled `messages[]`
  without dispatching to a provider. Useful for DevTools.

### Assembly modules

Under `server/fastify/src/prompt/`:

- `assemble.ts` - walks the preset's `promptTemplate`. Substitutes
  `{{user}}`, `{{char}}`, persona, description, author note,
  example messages, scenario, jailbreak.
- `lorebook.ts` - constant + keyword + recursion. Budget-aware.
  Returns activation metadata (which entries fired, why) for
  `prompt` SSE events.
- `history.ts` - chat history shaping (role mapping, multimodal
  fold-in, ChatML-style assembly).
- `templates.ts` - prompt template cards (chat ranges, cache
  markers, systemized chat, position slots).
- `tokens.ts` - budget pruning. Reuses or ports the existing
  tokenizer dispatcher when the 7-8 token slice lands.
- `variables.ts` - `risuChatParser` port for variable expansion,
  `#when`, conditional cards.
- `scripts.ts` - prompt regex script chain used by history and later
  trigger/template paths.
- `modules.ts` - active module helpers for regex scripts, assets,
  and later lorebook/trigger consumers.
- `triggers.ts` - hooks `editInput` / `editRequest` into the
  server-side trigger/script processor port that lands in this
  phase.

### SSE events

The `chat` route streams:

- `stage` - `{ stage: "validate" | "prompt" | "provider" | "done",
status: "start" | "end" }`.
- `prompt` - the assembled `messages[]`, prompt info, lorebook
  activation report.
- `info` - telemetry (timings, token counts).
- `token` - raw provider tokens (non-authoritative; for UX).
- `message_patch` - the authoritative chat row changes.
- `side_effect` - `{ kind: "tts" | "image" | "inlay_screen" |
"hypav3_progress" | "stable_diff", ... }`.
- `warning` - non-fatal issues.
- `error` - terminal error; includes restoration patches.
- `done` - canonical final message + generation info.

### Browser changes

The browser-side prompt extraction modules from Phase 5 shrink to
thin adapters in server-backed mode. The coordinator posts to
`/api/v1/generate/chat` and iterates the stream. The bridge owns:

- UI lease, abort forwarding.
- Inlay asset collection (still browser-only).
- Side-effect dispatch (TTS playback, image preview).
- Local restoration on `error` / abort.

## Boundaries

- **Do not redesign the preset format.** Server reads what the
  browser already writes. Schema migration is out of scope.
- **Do not move memory yet.** This route reads Hypa V3 summaries
  through whatever adapter exists (browser or server) and ships
  them; Phase 8 wires the server-side adapter.
- **Do not implement plugin code execution.** Plugins that expose
  custom prompt items return their text via the existing browser
  bridge for now. Server-side plugin execution is out of the
  migration scope.
- **Do not change the SSE event shape across phases.** Once Phase
  7 ships an event, Phase 9 must not rename it.

## Exit criteria

- The Phase 4 / 5 fixture set runs against the server route and
  produces identical observable output (with the upstream provider
  faked at the server boundary).
- `pnpm api:test` includes prompt snapshot tests: given a canned
  database + preset + chat state, `assembled === expected`.
- `pnpm test`, `pnpm check`, `pnpm build`, `pnpm api:test` green.

## Landed slices

| Slice | Commit     | Summary                                                                                                                |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine-event SSE taxonomy, and added prompt module stubs. |
| 7-2a  | `9eed5093` | Added Svelte-free parser DI seams for chat variables and `trigger_id`.                                                 |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                          |
| 7-2c  | `7ed156e6` | Wired the server parser adapter and real `expandVariables`.                                                            |
| 7-3   | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                |
| 7-4   | `051a5dcd` | Ported plain prompt sections: main, jailbreak, global note, and role splitting.                                        |
| 7-5a  | `c44e53fc` | Ported the deterministic history walk: examples, start-new-chat marker, first message, filters, and role mapping.      |
| 7-6a  | `9a60380d` | Added the minimal regex script processor for preset and character scripts.                                             |
| 7-5b  | `7ad226b9` | Added per-message scripts, sendName wrapping, `<Thoughts>` extraction, and memo/UUID backfill.                         |
| 7-6b  | `8414d5c7` | Added scripts `@@`-action prefixes: no-op emotion, inject, move-top/bottom, and repeat-back.                           |
| 7-6c  | `5aae492b` | Added the `ableFlag` action DSL, outScript prep, `cbs`/`no_end_nl`, and SPA-parity flag defaults.                      |
| 7-6d  | `cb5675d8` | Wired module regex scripts into the script chain through active-module helpers.                                        |
| 7-5c  | `50a1770b` | Added history multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module asset triples.                        |
| 7-7a  | `c815e067` | Ported lorebook constant (always-on) entries with the in-scope decorator scaffold and `inject_lore` rewrites.          |
| 7-7b  | `25388d7d` | Added lorebook keyword matching: `searchMatch`, child mirror, conditional-activation decorators, and `matchLog`.       |

## Remaining roadmap

The work splits into five tiers. Slices inside a tier can run in
parallel by different agents; the inter-tier dependencies in the
"Depends on" annotations are real and must hold. **Decide concrete
LOC + test scope at the start of each slice** — the breakdown below
is the planning resolution, not a contract.

### Tier 1 — Fill in the assembly module stubs

Order chosen to minimize cross-stub coupling.

**7-5a … 7-5e — History shaping.** Port `buildHistoryWindow` +
`formatHistoryMessage` from `src/ts/process/promptAssembly/`. The
SPA modules are tightly coupled to Tier 2 infrastructure; split
along the dependency seams:

- **7-5a** — Minimal walk. Examples + `[Start a new chat]` marker
  - first message + `makeMs` filter (`disabled`/`allBefore`) +
    role mapping. ~150 LOC, ~12 tests. Independently shippable.
    **Landed `c44e53fc`** (16 tests, api:test 486 → 502).
- **7-5b** — Per-message script processing + `sendName` wrapper +
  `<Thoughts>` extraction. Depends on Scripts (7-6).
  **Landed `7ad226b9`** (13 tests, api:test 516 → 529).
- **7-5c** — Multimodal inlays + `{{asset_prompt::}}` replacement.
  **Landed `50a1770b`** (13 tests, api:test 569 → 582).
- **7-5d** — Start trigger integration. Depends on Triggers (7-9c).
- **7-5e** — Tokenizer accumulation + depthPrompts wiring. Depends
  on Tokens (7-8) and Lorebook (7-7e).

**7-6 — Scripts port.** Port `processScript` + `processScriptFull`
from `src/ts/process/scripts.ts` (431 LOC in the SPA). Now in
progress as sub-slices.

- **7-6a** — Minimal regex chain (preset + character, mode filter,
  flag sanitization, CBS in replacement). **Landed `9a60380d`**
  (14 tests, api:test 502 → 516). Unblocks 7-5b.
- **7-6b** — Special action prefixes: `@@move_top`,
  `@@move_bottom`, `@@inject`, `@@repeat_back` (server-implementable
  deterministic text ops, and a documented `@@emo` no-op since the
  emotion-image side effect is browser-only). **Landed `8414d5c7`**
  (16 tests, api:test 529 → 545). Per-message history walk now
  threads `index` + `currentChat` so these actions fire correctly.
- **7-6c** — `ableFlag` `<order N, actions…>` flag-meta DSL: parse
  `<…>` segments out of `script.flag` into `{order, actions[]}`,
  stable-sort by `order desc`, route `actions.includes('inject' |
'move_top' | 'move_bottom' | 'repeat_back')` to the existing 7-6b
  paths, implement the `'cbs'` action (pre-expand `script.in`) and
  `'no_end_nl'` action (suppress the trailing-`>` newline).
  **Landed `5aae492b`** (12 new + 4 updated tests, api:test 545 →
  557). Also corrected the default-flag-is-`'g'` and
  `ableFlag`-gated-`script.flag` SPA-parity bugs the 7-6a tests
  had silently asserted wrong.
- **7-6d** — Module regex scripts: `server/fastify/src/prompt/modules.ts`
  ports `getModules()` + `getModuleRegexScripts()`; `processScript`
  chain is now `presetRegex` → `char.customscript` → `moduleRegex`.
  **Landed `cb5675d8`** (12 tests across `modules.test.ts` +
  `scripts.test.ts`, api:test 557 → 569).
- **7-6e** — Script-cache (`generateScriptCacheKey` +
  `getScriptCache` + `cacheScript`) and `runTrigger('display', …)`
  for `editdisplay` mode. Both are optional polish: the cache is
  a pure optimization (the server runs each chain fresh per
  assembly), and `editdisplay` is blocked on Triggers (7-9).

Browser-only paths (`runLuaEditTrigger`, `pluginV2[mode]`) are
out-of-scope for the server port; the SPA continues to use them
client-side.

**7-7a … 7-7e — Lorebook activation.** Port
`src/ts/process/lorebook.svelte.ts` + `buildLorebookContext.ts`.
Tentative breakdown:

- **7-7a** — Constant entries (always-on). **Landed `c815e067`**
  (16 tests in `lorebook.test.ts`, api:test 582 → 598). Decorator
  scaffold covers `role`, `position`, `depth`/`reverse_depth`,
  `end`, `priority`, `ignore_on_max_context`, the four
  `inject_*` forms, and `disable_ui_prompt`; everything else hits
  `default: return false` (SPA parity for unknown decorators) and
  stays literal in the prompt text until its sub-slice lands.
  `inject_lore` rewrites are applied in-pass so 7-7d/7-10 do not
  need a re-walk.
- **7-7b** — Keyword matching activation. **Landed `25388d7d`**
  (18 new tests, api:test 598 → 616). `searchMatch` port for the
  non-recursive single-pass case; in-scope decorators now include
  `additional_keys` (AND-required across queries),
  `exclude_keys`, `exclude_keys_all`, `match_full_word`,
  `match_partial_word`, `scan_depth`, `activate_only_after`,
  `activate_only_every`, `is_greeting`, `probability`,
  `activate`, `dont_activate`, `keep_/dont_activate_after_match`.
  `mode === 'child'` mirrors when the previous same-id parent
  didn't fire. Chat-var keys derive from `entry.id` or
  `pickHashRand(5555, entry.content)` via the new Svelte-free
  `src/ts/util/loreHash.ts`. `matchLog` widens from `never[]` to
  `LoreMatchLogEntry[]`.
- **7-7c** — Recursive activation within depth limit.
- **7-7d** — Budget-aware truncation.
- **7-7e** — Depth-prompt emission for history (consumed by 7-5e).

### Tier 2 — Supporting infrastructure

**7-8a … 7-8c — Tokens / budget.** Port
`src/ts/process/promptBudget/{preflightTemplateTokens,
finalizeRequestBudget}.ts`.

- **7-8a** — Tokenizer integration on the server. The SPA's
  `src/ts/tokenizer.ts` dispatcher is partly environment-agnostic;
  decide reuse vs port at slice start.
- **7-8b** — Token preflight accounting.
- **7-8c** — Budget finalization (pruning order, fallback chains).

**7-9a … 7-9c — Triggers.** Port `src/ts/process/triggers.ts`.

- **7-9a** — Trigger sandbox infrastructure (the
  `processScriptFull` layer for trigger bodies; may reuse 7-6's
  port).
- **7-9b** — `editInput` / `editRequest` hooks.
- **7-9c** — `start` trigger (consumed by 7-5d).

**7-10a … 7-10e — Preset templates.** Port the template-card
logic from `src/ts/process/promptAssembly/{normalizeTemplate,
buildStaticPromptSections, buildPlainPromptSections,
systemizeChat}.ts` (the static sections themselves already
landed in 7-3 / 7-4; this tier is about the card-walking +
preset-structure parser).

- **7-10a** — Card parsing + normalization.
- **7-10b** — Chat range cards.
- **7-10c** — Cache markers.
- **7-10d** — Position slots.
- **7-10e** — Systemized chat hoisting.

### Tier 3 — Root + route wiring

**7-11a … 7-11d — `assemble.ts` + route.** All Tier 1 + 2 modules
must be real before these land.

- **7-11a** — `assemble.ts` root entry stitching static + plain +
  lorebook + history + tokens through templates.
- **7-11b** — Wire `POST /api/v1/generate/chat` (currently emits
  "not yet implemented") to call `assemble.ts` and emit `prompt`
  - `done` SSE events.
- **7-11c** — Add `POST /api/v1/generate/preview-prompt` shortcut.
- **7-11d** — SSE telemetry: `info` event (timings, token counts),
  `message_patch` for chat-row deltas.

### Tier 4 — Browser adapter

After Tier 3 is real. The browser-side prompt extraction modules
from Phase 5 shrink to thin SSE iterators.

- **7-12a** — Client adapter for `/api/v1/generate/chat`.
- **7-12b** — Dual-mode fixture sweep: re-run the 12 server-backed
  sendChat fixtures through the new `/chat` route.
- **7-12c** — Side-effect dispatch (TTS playback, image preview,
  `hypav3_progress` UX) via the SSE `side_effect` event.
- **7-12d** — Restoration on error / abort from the SSE `error`
  event's restoration payload.

### Tier 5 — Closeout

**7-13 — Phase 7 closeout.** Refresh
`phase-7-prompt-assembly.md` with the Closeout section. Flip
[`HANDOVER.md`](../../../HANDOVER.md) and `next-steps.md` to
Phase 8 (memory) as the next phase. The three providers
deferred for server-owned flattening (Ooba OAI-compat, NovelAI
text, NovelList) can now route through `assemble.ts`; that work
may land as a polish slice before closeout or as the first
post-closeout follow-up.

## Reference

- `move-to-fastify` lands a Phase-7 ancestor as
  `/api/v1/generate/completion-with-assembly`. We are skipping
  that indirection; `chat` is the assembled endpoint.
- `risuai-metatron`'s `chat_generation/prompt_builder.py`,
  `prompt_sections.py`, `prompt_history.py`, `prompt_templates.py`,
  `prompt_budget.py`, `context.py`, `lorebook.py` are the closest
  template at full scale. Plan on the assembly modules being
  smaller than that (the Python port absorbed years of drift).
