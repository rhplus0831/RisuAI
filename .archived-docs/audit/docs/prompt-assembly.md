# Prompt assembly, template ordering, and token budgeting (`PA`)

Fastify side: `server/fastify/src/prompt/assemble.ts`, `templates.ts`,
`staticSections.ts`, `plainSections.ts`, `tokens.ts`, `budgetFinalize.ts`.
Original side: `src/ts/process/prompt.ts` and the `sendChat` assembly loop in
`src/ts/process/index.svelte.ts`, plus `src/ts/tokenizer.ts` (all
`@71c476e9c`). See [README.md](README.md) for baseline and format.

## Open findings

### PA-1 — Character additional-information retrieval is omitted [high]

- **Verification:** code-verified (also found independently by two agents)
- **Classification:** UNCLEAR — acknowledged only by a source comment
  (`staticSections.ts:18`), not documented as a supported incompatibility.
- **Fastify:** `server/fastify/src/prompt/staticSections.ts:18`, `:43`
- **Original:** `src/ts/process/index.svelte.ts:430`,
  `src/ts/process/embedding/addinfo.ts:5` `@71c476e9c`
- **Difference:** The original split `currentChar.additionalText` into blocks,
  similarity-searched them against the first four chat messages, expanded CBS
  in up to three selected blocks, and appended them to the character
  description. Fastify explicitly excludes `additionalInformations` from
  static sections while the character field remains exposed in the UI.
- **Scenario:** Put `The vault code is 7319.` in a character's additional
  information and discuss the vault in the opening messages. The original
  includes the retrieved block in the description; Fastify never sends it.

### PA-2 — Stable template cards are cached before the start trigger [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/templates.ts:315`, `:354`,
  `server/fastify/src/prompt/assemble.ts:1469`, `:2008`
- **Original:** `src/ts/process/index.svelte.ts:619`, `:825`, `:1208`
  `@71c476e9c`
- **Difference:** Fastify expands "stable" cards during preflight, before the
  start trigger runs, and reuses those cached expansions in the final render.
  The original also pre-expanded, but expanded the cards again after the start
  trigger, so trigger-driven state changes reached the final prompt.
- **Scenario:** Start with `$mood=before`, use a plain card containing
  `Mood={{getvar::mood}}`, and a start trigger that sets `$mood=after`. The
  original sends `Mood=after`; Fastify sends the cached `Mood=before` even
  though the persisted variable becomes `after`.

### PA-3 — Image tokens are excluded from context budgeting [medium]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/tokens.ts:204`,
  `server/fastify/src/prompt/budgetFinalize.ts:21`, `:47`
- **Original:** `src/ts/tokenizer.ts:421`, `:448`,
  `src/ts/process/index.svelte.ts:976` `@71c476e9c`
- **Difference:** Fastify counts text, message overhead, names, and thoughts
  but ignores `multimodals`. The original charged `tokenizeMultiModal` per
  attachment (fixed 87 tokens for low-quality images, tiled-size math
  otherwise), which changes which history rows fit the window.
- **Scenario:** On a vision model near `maxContext`, a history row with a
  low-quality image: the original may trim an older row; Fastify keeps it
  based on text-only counting and can dispatch an over-budget request.

### PA-4 — Repeated mixed chat cards can produce different roles [low]

- **Verification:** agent-reported
- **Classification:** BUG (the clone is deliberate, but the assumption that
  output is identical does not hold for repeated mixed cards)
- **Fastify:** `server/fastify/src/prompt/templates.ts:529`
- **Original:** `src/ts/process/index.svelte.ts:1324`, `:2030` `@71c476e9c`
- **Difference:** The original took a shallow history slice, and
  `systemizeChat` mutated the shared message objects, so systemizing one chat
  card affected later cards. Fastify structured-clones the slice first.
- **Scenario:** With `sendChatAsSystem` and two chat cards over the same
  range (the second with `chatAsOriginalOnSystem: true`), the original emits
  systemized rows from both cards; Fastify emits system roles from the first
  and original user/assistant roles from the second.

### PA-5 — Persisted response-token metadata loses the headroom clamp [low]

- **Verification:** agent-reported
- **Classification:** UNCLEAR — profile-metadata overwriting is tested
  (`server/fastify/__tests__/generation.chat.test.ts:6447`), but losing the
  assembly clamp is not separately documented.
- **Fastify:** `server/fastify/src/routes/generationChat.ts:946`, `:253`
- **Original:** `src/ts/process/index.svelte.ts:1465` `@71c476e9c`
- **Difference:** Fastify initially records the assembler's clamped
  `outputTokens` but overwrites it with `database.maxResponse` after provider
  profile selection. The original retained the headroom-clamped value in
  `generationInfo`. Dispatch behavior generally matches; this is a
  streamed/persisted metadata discrepancy.
- **Scenario:** `maxResponse=200` with only 60 context tokens of headroom:
  original metadata reports `outputTokens: 60`; Fastify persists 200.

## Confirmed intentional divergences (no work items)

- **Stable template cards execute state-changing CBS** (`runVar: true`,
  setvar persists and is stripped from the provider prompt; the original left
  the directives literal). Pinned by
  `server/fastify/__tests__/assemble.test.ts:4484` and
  `server/fastify/__tests__/templates.test.ts:983`.
- **Global-note replacement applies positional injection once** (the original
  applied injection both inside and after `{{original}}` composition).
  Documented in `docs/structure/providers-and-models.md:323`; pinned by
  `server/fastify/__tests__/templates.test.ts:1005`.
- **Non-Hypa `lastMemory` cutoff is only advanced on an actual trim** (the
  original recorded the synthetic `NewChat` marker even when nothing was
  trimmed). Pinned by `server/fastify/__tests__/memory.test.ts:45`.
- **Depth-prompt CBS is evaluated once instead of twice** (time/random CBS in
  depth entries no longer re-rolls between preflight and insertion). Pinned
  by `server/fastify/__tests__/assemble.test.ts:4440`.

## Areas verified clean

Default-template normalization; implicit post-everything insertion;
utility-template forcing; adjacent-message coalescing; empty-content
skipping; main/jailbreak/plain/ChatML/CoT/persona/description/author-note/
memory/lorebook-slot/post-everything ordering (apart from the findings
above); author-note default text and `innerFormat`; `<START>` example-message
parsing/roles/placement; continue-mode history construction;
depth/reverse-depth index arithmetic; text-only token overhead constants and
oldest-first trimming; tokenizer-family selection and model routing
(including the OpenRouter Llama routing quirk); effective
model/profile/preset precedence. Group chat is a documented no-port.
