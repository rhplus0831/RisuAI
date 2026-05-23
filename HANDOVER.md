# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `c0f3fb3a feat: lorebook depth-prompt emission (Phase 7-7e)`

The strategic view of remaining Phase 7 slices lives in
[`ROADMAP.md`](ROADMAP.md). This file stays as the day-to-day
handoff with the current head, baselines, and the next pickup.

This is the short runbook for picking up **Phase 7 in progress**.
Phases 0-6 are closed. The detailed Phase 7 roadmap lives in
[`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md);
this file only records the current handoff state and the next slice.

## Current State

Landed Phase 7 slices:

| Slice | Commit     | Summary                                                                                                                      |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine prompt SSE event names, and added prompt module shells.  |
| 7-2a  | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                              |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                                |
| 7-2c  | `7ed156e6` | Wired the server parser adapter: `promptScope.ts`, `cbsAdapter.ts`, `promptVariablesBoot.ts`, and real `expandVariables`.    |
| 7-3   | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                      |
| 7-4   | `051a5dcd` | Ported plain prompt sections: main, jailbreak, and global note.                                                              |
| docs  | `e7a76f32` | Organized the remaining Phase 7 roadmap into tiers.                                                                          |
| 7-5a  | `c44e53fc` | Ported the minimal history walk: examples, start-new-chat marker, first message, makeMs filter, per-message role mapping.    |
| 7-6a  | `9a60380d` | Ported the minimal regex script processor: preset+character regex chain, mode filter, flag sanitization, CBS in replacement. |
| 7-5b  | `7ad226b9` | Added per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill on the history walk.             |
| 7-6b  | `8414d5c7` | Added scripts `@@`-action prefixes: `@@emo` (no-op), `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`.             |
| 7-6c  | `5aae492b` | Added `ableFlag <order, actions>` DSL, `cbs`/`no_end_nl` actions, outScript prep, and SPA-parity flag defaults.              |
| 7-6d  | `cb5675d8` | Wired module regex scripts into the script chain via new `getActiveModules` + `getModuleRegexScripts` helpers.               |
| 7-5c  | `50a1770b` | Added history multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module asset triples.                              |
| 7-7a  | `c815e067` | Ported lorebook constant (always-on) entries with the in-scope decorator scaffold and `inject_lore` rewrites.                |
| 7-7b  | `25388d7d` | Added lorebook keyword matching: `searchMatch` port, child mirror, conditional-activation decorators, and `matchLog`.        |
| 7-7c  | `b11902ad` | Added lorebook recursive activation: `while (matching)` loop, `recursivePrompt` accumulation, three recursion decorators.    |
| 7-7e  | `c0f3fb3a` | Added lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.          |

What is real in code:

- `server/fastify/src/routes/generationChat.ts` validates request
  bodies and emits `stage(validate)` -> `error` -> `done`; it does
  **not** call `assemble.ts` yet.
- `server/fastify/src/prompt/sseEvents.ts`,
  `variables.ts`, `staticSections.ts`, `plainSections.ts`,
  `history.ts` (deterministic walk + per-message scripts +
  sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill,
  multimodal inlays, `{{asset_prompt::}}`, and the `applyDepthPrompts`
  splicer from 7-7e), `scripts.ts` (full SPA-parity regex chain:
  preset + character + module regex, `@@`-actions, `ableFlag` DSL,
  `cbs` / `no_end_nl` actions, outScript prep), `modules.ts`
  (`getActiveModules` + `getModuleRegexScripts` + `getModuleAssets`),
  and `lorebook.ts` (full activation surface — constant / keyword /
  recursive activation with `searchMatch`, child mirror,
  conditional-activation decorators, recursion loop with
  `recursivePrompt` + `recursive`/`unrecursive`/`no_recursive_search`,
  `matchLog`, `inject_lore` rewrites, `disabledUIPrompts`, plus the
  `getDepthPrompts` / `resolvePosition` depth-prompt helpers) are
  implemented and tested.
- `assemble.ts`, `templates.ts`, `tokens.ts`, and `triggers.ts`
  still throw Phase 7 not-implemented errors.
- `history.ts` does not yet handle start triggers or tokenizer
  accumulation (7-5d/e).
- `scripts.ts` does not yet handle script-cache,
  `runLuaEditTrigger`, `runTrigger('display', …)`, or `pluginV2`
  hooks — all 7-6e or out-of-scope.
- `lorebook.ts` covers the full activation surface (constant
  / keyword / recursive / depth-prompt). The only deferred
  lorebook slice is 7-7d (budget-aware truncation), blocked on
  Tokens (7-8a) for the real per-entry `tokens` field.
- There is no `/api/v1/generate/preview-prompt` route yet.

Last recorded baselines after 7-7e:

- `pnpm api:test`: 640 across 35 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: passes with existing CSS / bundle-size warnings

## Next Slice — 7-8a server tokenizer

Pick up **7-8a — server tokenizer**.

The lorebook chain is closed at a clean cut: 7-7d is the only
remaining lorebook slice, and it can't progress until the
tokenizer attaches a real `tokens` field to each
`LoreEntryActive`. 7-8a unblocks **both** 7-7d (lorebook
budget filter) and 7-5e (history tokenizer accumulation +
depth-prompt token preflight), so it's the biggest single
unblocker in Tier 2.

### Why tiktoken-only

The SPA's `src/ts/tokenizer.ts` is a 654-LOC dispatcher across
**17 tokenizer types** (`tik`, `mistral`, `claude`, `llama`,
`gemma`, etc.). Most non-OpenAI paths route through
`@mlc-ai/web-tokenizers` or `@huggingface/transformers`, which
are browser-oriented (WASM fetch, manual tokenizer-JSON loading
via `fetch('/token/llama/...')`).

**For 7-8a ship tiktoken only.** Rationale:

- The two immediate consumers (7-7d lorebook budget filter, 7-5e
  history token accumulation) are heuristics. Approximate counts
  work fine — and tiktoken **overcounts** for Claude / Llama /
  Gemma text (denser native tokenizers on Unicode), which is the
  safe failure mode for budget filtering (more headroom, never
  under-budgeted).
- `@dqbd/tiktoken` ships native Node bindings (`tiktoken.cjs`)
  and per-encoder JSON files. Drop-in usable from the server.
- Per-provider exact tokenizers can land per-fixture as their use
  cases arrive; document the approximation in a top-of-file
  comment.

### Files

1. `server/fastify/src/prompt/tokens.ts` — full rewrite (the
   current 20-line throwing stub goes away).
2. `server/fastify/__tests__/tokens.test.ts` — new file
   (~120 LOC).

### Public surface

```ts
export type TokenEncoding = 'cl100k_base' | 'o200k_base'

/**
 * Picks the tiktoken encoder for a model name. Mirrors the SPA's
 * `encode()` dispatcher (src/ts/tokenizer.ts:88-244) for the
 * OpenAI-family branches; everything else falls back to
 * cl100k_base which slightly *over*counts for Claude/Llama/Gemma
 * text — the safe direction for budget heuristics.
 */
export function encodingForModel(model: string | undefined): TokenEncoding

export function tokenize(text: string, model?: string): number

export interface ChatTokenizerOptions {
  /** Per-message overhead. SPA default for OpenAI is 4. */
  chatAdditionalTokens?: number
  /** When 'name', includes the chat.name field's tokens + 1. */
  useName?: 'name' | 'noName'
  /** When true, count chat.thoughts as well (SPA's tokenizeChat arg). */
  countThoughts?: boolean
}

/** Mirrors SPA's `ChatTokenizer.tokenizeChat` for text-only paths. */
export function tokenizeChat(
  chat: OpenAIChat,
  model: string | undefined,
  opts?: ChatTokenizerOptions,
): number

export function tokenizeChats(
  chats: OpenAIChat[],
  model: string | undefined,
  opts?: ChatTokenizerOptions,
): number
```

**Synchronous.** The SPA's async signature is just dynamic
`import()`; on the server use static imports + a lazy
module-scope cache:

```ts
import { Tiktoken } from '@dqbd/tiktoken'
import cl100k from '@dqbd/tiktoken/encoders/cl100k_base.json'
import o200k from '@dqbd/tiktoken/encoders/o200k_base.json'

const encoders = new Map<TokenEncoding, Tiktoken>()
function getEncoder(name: TokenEncoding): Tiktoken {
  let enc = encoders.get(name)
  if (!enc) {
    const src = name === 'cl100k_base' ? cl100k : o200k
    enc = new Tiktoken(src.bpe_ranks, src.special_tokens, src.pat_str)
    encoders.set(name, enc)
  }
  return enc
}
```

### Model → encoding heuristic

Match the SPA's actual model-to-encoder routing for the families
that matter (verify the exact prefix list against
`src/ts/model/modellist.ts` so the routing matches what each
`LLMTokenizer.tiktokenO200Base` model actually wants):

```ts
export function encodingForModel(model: string | undefined): TokenEncoding {
  if (!model) return 'cl100k_base'
  // o200k_base covers gpt-4o, gpt-4.1, o1, o3, o4, gpt-5, gpt-oss.
  if (
    model.startsWith('gpt-4o') ||
    model.startsWith('gpt-4.1') ||
    model.startsWith('gpt-5') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4') ||
    model.startsWith('gpt-oss')
  )
    return 'o200k_base'
  // Everything else (gpt-3.5, gpt-4, Claude, Gemini, Mistral,
  // Cohere, DeepSeek, Llama, NovelAI, NovelList, Bedrock, custom)
  // falls back to cl100k_base.
  return 'cl100k_base'
}
```

If the prefix list gets noisy, swap for a small `Set<string>`
lookup on common model ids.

### `tokenizeChat` body

Port the SPA's `ChatTokenizer.tokenizeChat` minus multimodal
(deferred to 7-8b/c if a fixture demands it):

```ts
export function tokenizeChat(
  chat: OpenAIChat,
  model: string | undefined,
  opts: ChatTokenizerOptions = {},
): number {
  const overhead = opts.chatAdditionalTokens ?? 4
  let total = tokenize(chat.content ?? '', model) + overhead
  if (chat.name && opts.useName === 'name') {
    total += tokenize(chat.name, model) + 1
  }
  if (opts.countThoughts && chat.thoughts && chat.thoughts.length > 0) {
    for (const t of chat.thoughts) total += tokenize(t, model) + 1
  }
  return total
}
```

### Multimodal — deferred to 7-8b/c

The SPA's image-token math
(`src/ts/tokenizer.ts:507-541`) depends on `db.gptVisionQuality`
plus `MultiModal.height`/`width`. For 7-8a skip it;
`tokenizeChat` ignores `chat.multimodals`. Add a one-line doc
comment noting the deferral.

When a fixture lands that needs accurate multimodal counts, port
it as a small extension to `ChatTokenizerOptions`
(e.g. `imageTokens: 'gpt-low' | 'gpt-high' | 'skip'`).

### Tests

`server/fastify/__tests__/tokens.test.ts`, **~9 cases**, no
`bootPromptVariables` needed (pure function path):

1. `encodingForModel('gpt-4o')` → `'o200k_base'`.
2. `encodingForModel('gpt-4')` → `'cl100k_base'`.
3. `encodingForModel('claude-opus-4-7')` → `'cl100k_base'`
   (fallback).
4. `encodingForModel(undefined)` → `'cl100k_base'`.
5. `tokenize('', 'gpt-4o')` → 0.
6. `tokenize('hello world', 'gpt-4o')` → expected tiktoken count
   (capture ground-truth via a one-off script before locking the
   number).
7. `tokenizeChat({role:'user', content:'hello'}, 'gpt-4o')` →
   tokens('hello') + 4.
8. `tokenizeChat` with `name`+`useName:'name'` → extra
   `tokenize(name) + 1`.
9. `tokenizeChats` sums correctly across two messages.

Hardcoded oracle values must match what cl100k_base / o200k_base
actually produce. Run tiktoken in a one-off script first to
capture ground-truth numbers.

### Skip-list (still deferred to later 7-8 sub-slices)

- 7-8b — token preflight accounting across the template walker.
- 7-8c — budget finalization (pruning order, fallback chains).
- 7-7d — re-enter once 7-8a lands and slot the `tokens` field
  into `LoreEntryActive`.
- 7-5e — same; unblocked by 7-8a + 7-7e (7-7e already landed).
- Per-provider exact tokenizers (Mistral, Llama, Claude, Gemma,
  Cohere, DeepSeek, NovelAI, NovelList). Land per-fixture as
  needed.
- Multimodal image-token math.

### Risks / open questions

- **Tiktoken WASM in Node.** `@dqbd/tiktoken` Node entry uses
  native bindings (no WASM fetch). Should work cleanly on
  Node 22; if it doesn't, fall back to `@dqbd/tiktoken/lite`
  (pure JS).
- **JSON imports.** Server tsconfig has `resolveJsonModule: true`,
  so `import cl100k from '@dqbd/tiktoken/encoders/cl100k_base.json'`
  works. Confirmed `cl100k_base.json` ships in the installed
  package; verify `o200k_base.json` does too on first import. If
  not, copy from `src/etc/o200k_base.json` or import via the
  SPA's path.
- **Prefix list scope.** The model→encoding routing is the most
  likely place for a future bug; cross-check
  `src/ts/model/modellist.ts` rows tagged
  `LLMTokenizer.tiktokenO200Base` before locking the list. If
  there are oddballs (model ids that don't start with any
  `o200k` prefix), promote to a `Set<string>` lookup.

### Scope size

| Area        | Files                                       | LOC est. |
| ----------- | ------------------------------------------- | -------- |
| `tokens.ts` | `server/fastify/src/prompt/tokens.ts`       | ~70      |
| Tests       | `server/fastify/__tests__/tokens.test.ts`   | ~120     |
| Docs        | HANDOVER + ROADMAP + phase doc + next-steps | small    |

### After-land checklist

- Run all four bars (`pnpm check`, `pnpm api:test`, `pnpm test`,
  `pnpm build`). Expected api:test: **640 → ~649**.
- Two-commit rhythm: `feat: server tokenizer (Phase 7-8a)` then
  `docs: backfill Phase 7-8a in handover and roadmap`.
- Flip "Next Slice" to **7-7d (lorebook budget filter)**, now
  unblocked. 7-7d is small (~50 LOC) — slot it next so the
  lorebook chain fully closes before tokens 7-8b/c.

### Fallback if 7-8a sprawls

If the dispatcher matrix turns out wider than expected (e.g.
o200k_base JSON missing from the installed `@dqbd/tiktoken` and
the workaround proves messy), defer to **7-9a — trigger
sandbox** or **7-10a — template card parsing**. Both are
independently shippable parallel fronts.

## Patterns To Keep

- Prefer DI seams over importing Svelte modules from server code.
  Existing patterns: `chatVarBackend.ts`, `parserStateBackend.ts`,
  and `promptVariablesBoot.ts`.
- `promptScope.ts` is a module-level singleton for the active
  database/chat scope. That matches the current single-user
  migration assumption. Switch to `AsyncLocalStorage` only when a
  later phase introduces real concurrent prompt assembly.
- Any user text that may contain parser syntax should flow through
  `expandVariables(input, ctx) -> { text, dirty }`.
- New prompt leaves should return structured values or normalized
  `OpenAIChat[]` arrays, following the Option B normalization used
  by 7-3.

## Boundaries

- Phase 8 owns server-side Hypa V3 memory.
- Phase 9 owns the server-side `.risu` codec and client command
  thinning.
- Plugin code execution stays browser-side for this migration.
- Ooba OAI-compatible, NovelAI text, and NovelList remain local-only
  until Phase 7 gives the server a complete prompt-flattening path.

## Docs And Commits

- Use commit titles like `feat:`, `fix:`, `refactor:`, and `docs:`.
- After a feature slice, update:
  - [`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md)
  - [`docs/fastify/status/next-steps.md`](docs/fastify/status/next-steps.md)
  - this file
- Keep detailed planning in the phase doc and keep this file short.
- Two-commit rhythm per slice (used by 7-7a/b/c/e): a `feat:`
  commit with code + tests, then a `docs:` commit that backfills
  the real SHA into HANDOVER + ROADMAP + phase doc + next-steps.

## Pointers

- [`docs/fastify/status/next-steps.md`](docs/fastify/status/next-steps.md)
  has the immediate work item and landed Phase 6/7 slice tables.
- [`docs/fastify/status/server.md`](docs/fastify/status/server.md)
  tracks the actual Fastify route surface.
- [`docs/fastify/coverage/server-routes.md`](docs/fastify/coverage/server-routes.md)
  tracks route and prompt-leaf test coverage.
- Provider deferral memos:
  [`docs/fastify/design/ooba-oai-compat.md`](docs/fastify/design/ooba-oai-compat.md)
  and
  [`docs/fastify/design/novelai-novellist-stringlize.md`](docs/fastify/design/novelai-novellist-stringlize.md).

## Verification

For docs-only updates:

```bash
pnpm exec prettier --check docs HANDOVER.md
```

For a Phase 7 code slice:

```bash
pnpm check
pnpm api:test
pnpm test
pnpm build
```

Tauri build is verified manually at phase boundaries.
