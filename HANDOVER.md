# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `0536e84e docs: backfill Phase 7-4 commit hash`

This file is the working handover for **Phase 7 in progress**. Phases
0-6 are closed. Phase 7 has six slices landed; the rest of the phase
is a multi-step roadmap that this doc lays out below.

## Current state

### What's landed in Phase 7

| Slice | Commit     | What it did                                                              |
| ----- | ---------- | ------------------------------------------------------------------------ |
| 7-1   | `3d2426c4` | Scaffolded `POST /api/v1/generate/chat`, locked the 9-event SSE taxonomy, stubbed seven `server/fastify/src/prompt/*.ts` modules. |
| 7-2a  | `9eed5093` | DI seams for `chatVar` + `triggerId`. `cbs.ts` is now Svelte-free.       |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` + helpers into Svelte-free shared modules; `parser.svelte.ts` re-exports for the 426 SPA call sites. |
| 7-2c  | `7ed156e6` | Server adapter: `promptScope.ts`, `cbsAdapter.ts`, `promptVariablesBoot.ts`. Real `expandVariables` returning `{text, dirty}`. |
| 7-3   | `d0a2a7f3` | Static prompt sections (`buildDescription`, `buildAuthorNote`, `buildPersona`, `buildCotInstruction`). |
| 7-4   | `051a5dcd` | Plain prompt sections (`buildPlainPromptSections` → `{main, jailbreak, globalNote}`). |

### Test counts as of `0536e84e`

- `pnpm api:test`: 486 across 31 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean

### What's running where

- `server/fastify/src/prompt/sseEvents.ts` — locked event taxonomy.
- `server/fastify/src/prompt/variables.ts` — real (7-2c).
- `server/fastify/src/prompt/staticSections.ts` — real (7-3).
- `server/fastify/src/prompt/plainSections.ts` — real (7-4).
- `server/fastify/src/prompt/{assemble,lorebook,history,templates,tokens,triggers}.ts` — still throwing stubs.
- `server/fastify/src/routes/generationChat.ts` — emits `phase-7 prompt assembly not yet implemented` after the validate stage; **does not yet call `assemble.ts`**.

## Architectural pattern that's emerged

Three load-bearing pieces other slices should follow:

1. **DI seams over direct imports.** When a server-side module needs
   browser-state-coupled functionality, add a `setXxxBackend({...})`
   module (`chatVarBackend.ts`, `parserStateBackend.ts`). Browser
   registers via `chatVar.svelte`'s module init or equivalent;
   server registers at boot via `promptVariablesBoot.ts`.

2. **Module-level singleton scope per request.** `promptScope.ts`
   holds the active `Database` + `selectedCharID` + `chatPage` +
   chat-var pointers in module-level state. Route handler calls
   `setActivePromptScope` / `clearActivePromptScope` around the
   work. Concurrent requests interleave (matches SPA's
   `DBState.db` race semantics) — acceptable under the
   **single-user** assumption documented in
   [`docs/fastify/plan.md:163`](docs/fastify/plan.md). Revisit with
   `AsyncLocalStorage` only when Phase 8/9 introduces concurrent
   server-driven work.

3. **`expandVariables(input, ctx) → {text, dirty}`** is the
   substitution primitive. Every assembly slice that touches user
   text should route through it. `dirty=true` surfaces `{{setvar}}` /
   `{{addvar}}` mutations to the route handler for write-back.

## Roadmap from here

The phase doc's seven assembly modules + the route wiring + the
browser adapter all still need to land. The breakdown below is
**tiered, not strictly sequential** — some slices can be done in
parallel by different agents if needed, but the dependencies in the
"Tier" labels are real.

### Tier 1 — Assembly module stubs (current focus)

Fill in the empty assembly modules so the eventual `assemble.ts`
has working leaves to call. Order chosen to minimize cross-stub
dependencies.

- **Slices 7-5a … 7-5e — History shaping.** Port
  `buildHistoryWindow` + `formatHistoryMessage` from
  `src/ts/process/promptAssembly/`. Split per the dependency seams:
  - 7-5a (~150 LOC): Minimal walk — examples + start-new-chat
    marker + first message + makeMs filter + role mapping.
  - 7-5b (~150 LOC): Per-message script processing +
    `sendName` wrapper + `<Thoughts>` extraction. **Depends on
    Scripts (7-6).**
  - 7-5c (~200 LOC): Multimodal inlays + `{{asset_prompt::}}`.
    **Depends on Phase 2's assets API.**
  - 7-5d (~150 LOC): Start trigger integration.
    **Depends on Triggers (7-9).**
  - 7-5e (~100 LOC): Tokenizer accumulation + depthPrompts
    wiring. **Depends on Tokens (7-8) and Lorebook (7-7).**

- **Slice(s) 7-6 — Scripts port.** Port `processScript` +
  `processScriptFull` from `src/ts/process/scripts.ts`. The SPA
  module is ~700 LOC and itself has its own dep map (regex
  scripting, custom-script execution, edit-time vs post-time
  phases). Almost certainly needs sub-slicing. Decide the breakdown
  at the start of the slice. **Prerequisite for 7-5b.**

- **Slices 7-7a … 7-7e — Lorebook activation.** Port
  `src/ts/process/lorebook.svelte.ts` +
  `buildLorebookContext.ts`. Tentative breakdown:
  - 7-7a: Constant entries (always-on).
  - 7-7b: Keyword matching activation.
  - 7-7c: Recursive activation (within depth limit).
  - 7-7d: Budget-aware truncation.
  - 7-7e: Depth-prompt emission for history.
  Decide concrete LOC + test scope at the start of each.

### Tier 2 — Supporting infrastructure

- **Slices 7-8a … 7-8c — Tokens / budget.** Port
  `src/ts/process/promptBudget/{preflightTemplateTokens,
  finalizeRequestBudget}.ts`. The tokenizer dispatcher already
  exists in `src/ts/tokenizer.ts`; the server can either reuse via
  a DI seam or port the dispatch (it's already environment-tagged).
  - 7-8a: Tokenizer integration on the server.
  - 7-8b: Token preflight accounting.
  - 7-8c: Budget finalization (pruning order, fallback chains).

- **Slices 7-9a … 7-9c — Triggers.** Port `src/ts/process/triggers.ts`.
  - 7-9a: Trigger sandbox infrastructure (the `processScriptFull`
    layer for trigger bodies).
  - 7-9b: `editInput` / `editRequest` hooks.
  - 7-9c: `start` trigger (consumed by 7-5d history start hook).

- **Slices 7-10a … 7-10e — Preset templates.** Port
  `src/ts/process/promptAssembly/{normalizeTemplate,
  buildStaticPromptSections, buildPlainPromptSections,
  systemizeChat}.ts` template-card logic (the static sections
  already partially landed in 7-3 / 7-4).
  - 7-10a: Card parsing + normalization.
  - 7-10b: Chat range cards (`{{#chat_range start::end}}`-style).
  - 7-10c: Cache markers.
  - 7-10d: Position slots.
  - 7-10e: Systemized chat hoisting.

### Tier 3 — Root + route wiring

- **Slices 7-11a … 7-11d — `assemble.ts` + route.**
  - 7-11a: `assemble.ts` walks the preset template and stitches
    static + plain + lorebook + history + tokens through templates.
  - 7-11b: Wire `POST /api/v1/generate/chat` (currently emits
    "not yet implemented") to call `assemble.ts` and emit `prompt`
    + `done` SSE events.
  - 7-11c: Add `POST /api/v1/generate/preview-prompt` shortcut.
  - 7-11d: SSE telemetry — `info` event with timings + token counts,
    `message_patch` for chat-row deltas.

### Tier 4 — Browser adapter (after Tier 3 is real)

- **Slices 7-12a … 7-12d.**
  - 7-12a: Client adapter for `/api/v1/generate/chat`.
  - 7-12b: Dual-mode fixture sweep — re-run the 12 server-backed
    sendChat fixtures through the new `/chat` route.
  - 7-12c: Side-effect dispatch (TTS playback, image preview,
    `hypav3_progress` UX) — needs the SSE `side_effect` event
    routed to the existing browser handlers.
  - 7-12d: Restoration on error / abort — the browser needs to roll
    back its local chat state from the SSE `error` event's
    restoration payload.

### Tier 5 — Closeout

- **Slice 7-13 — Phase 7 closeout.** Refresh
  `phases/phase-7-prompt-assembly.md` with the "Closeout" section
  enumerating what landed and what's deferred. Refresh HANDOVER.md
  to point at Phase 8 (memory) as the next phase.

### Out of scope (deferred to Phase 8 or 9)

- Hypa V3 memory adapter on the server side (Phase 8).
- Plugin code execution server-side.
- Server-side `.risu` codec (Phase 9 when browser stops owning a
  complete in-memory Database).
- The three providers requiring server-owned character / user state
  for prompt flattening — Ooba OAI-compat, NovelAI text, NovelList.
  Decision recorded as **D — wait for the server-side flatten**
  ([`design/ooba-oai-compat.md`](docs/fastify/design/ooba-oai-compat.md),
  [`design/novelai-novellist-stringlize.md`](docs/fastify/design/novelai-novellist-stringlize.md)).
  Once `assemble.ts` lands, those three providers can route through
  it.

## Patterns to follow

### When adding a new assembly slice

- New file at `server/fastify/src/prompt/<name>.ts`. Imports types
  via `import type` from the `.svelte.ts` storage / model modules
  (TypeScript erases at compile; no runtime pull).
- Each public function takes `ctx: ExpandContext` (defined in
  `server/fastify/src/prompt/variables.ts`) and returns either
  `OpenAIChat[]` or a structured result. Normalize array-typed
  returns even when the SPA's source returns a single object
  (the **Option B normalization** decided in 7-3).
- Internal text expansion goes through `expandVariables` so the
  9-event taxonomy in `sseEvents.ts` and the `dirty` write-back
  semantics in `promptScope.ts` stay consistent.

### When the new module needs a browser-only seam

- Add a `setXxxBackend({...})` module under `src/ts/parser/` or
  `src/ts/process/` (mirroring the `chatVarBackend.ts` /
  `parserStateBackend.ts` pattern).
- Browser registers at the relevant `.svelte.ts` module's init.
  Server registers in `promptVariablesBoot.ts` (or a sibling boot
  module if the scope is wider).
- Re-export the seam's pass-through getters from the SPA's existing
  re-export point (`parser.svelte.ts`, `scripts.ts`) so the 426 SPA
  call sites stay unchanged.

### When the source module pulls Svelte / DOM

- Type-only imports (`import type { ... }`) are always safe.
- For runtime values, extract into a sibling `.ts` (non-Svelte)
  file and re-export from the original `.svelte.ts` — the pattern
  established in 7-2b for `risuChatParser`.
- If extraction is too large for one slice, introduce a DI seam
  instead and port the actual function in a later slice.

### Tests

- New file at `server/fastify/__tests__/<name>.test.ts`.
- Each test boots the prompt-variable infrastructure once via
  `beforeAll(() => bootPromptVariables())`.
- Build a minimal `Database` snapshot via the three helpers
  (`makeChat`, `makeCharacter`, `makeDatabase`) — copy from any
  existing `__tests__/*.test.ts` in `prompt/`.
- Cast unsafe sub-objects with `as unknown as Type` for fields the
  test doesn't care about — the SPA's `Database` type has hundreds
  of optional fields and exhaustive construction is wasted code.
- Verify substitution behavior with explicit string comparisons
  (no snapshot tests in this phase — text is short, the spec is
  the source of truth).

## Commit + docs convention

- One slice per commit, prefix `feat:` / `refactor:` / `fix:` /
  `docs:`.
- Trailer:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- After each `feat:` slice, follow up with a `docs:` commit that
  appends the slice row to:
  - `docs/fastify/phases/phase-7-prompt-assembly.md` (Landed slices
    table).
  - `docs/fastify/status/next-steps.md` (Landed Phase 7 Slices
    table + Immediate section).

## Open questions held until the relevant slice

- **Scripts (7-6) port granularity.** `src/ts/process/scripts.ts`
  is ~700 LOC with its own dependency tree. Decide sub-slicing at
  the start of 7-6.
- **Tokenizer reuse vs port for 7-8.** The SPA's
  `src/ts/tokenizer.ts` dispatcher already takes `provider` /
  `model` / `format` parameters and is partly environment-agnostic.
  Decide reuse vs port when 7-8 starts.
- **Triggers sandbox (7-9).** The SPA runs trigger bodies through
  the same script processor as edit-time scripts. The server can
  either reuse the script processor port from 7-6 or build a
  separate sandbox. Decide when 7-9 starts.
- **Concurrency story.** Singleton scope works under the
  single-user assumption. If a Phase 8/9 design introduces parallel
  prompt-assembly requests (e.g., autoContinue retries running
  alongside a manual regenerate), swap to AsyncLocalStorage. Don't
  pre-optimize before that.

## Pointers

- [`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md) —
  phase doc with goal, scope, boundaries, exit criteria, and the
  landed-slices table.
- [`docs/fastify/status/next-steps.md`](docs/fastify/status/next-steps.md) —
  current immediate item + full Phase 6/7 slice history.
- [`docs/fastify/architecture.md`](docs/fastify/architecture.md) —
  server module layout reference.
- [`PARSER.md`](PARSER.md) — agent-written audit of `risuChatParser`
  and its CBS callback surface; useful when porting other parser
  consumers (`scripts.ts`, `triggers.ts`, `lorebook.svelte.ts`).
- [`docs/fastify/design/ooba-oai-compat.md`](docs/fastify/design/ooba-oai-compat.md) +
  [`docs/fastify/design/novelai-novellist-stringlize.md`](docs/fastify/design/novelai-novellist-stringlize.md) —
  memos covering the three deferred providers' decision.

## Verification before closing a slice

```bash
pnpm check       # 0 errors, 0 warnings
pnpm api:test    # 486 baseline as of 0536e84e
pnpm test        # 601 + 4 skipped baseline
pnpm build       # clean
```

Tauri build is verified manually at phase boundaries, not
per-slice.
