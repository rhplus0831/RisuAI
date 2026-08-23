# Brief A — Prompt assembly and request payload (Codex track)

Reference fork: `/home/codex/risu-baseline-71c476e9c` at `71c476e9c`. Current tree audited through `8bf88e43c` plus the present worktree. The audit found one compatibility issue.

## A-1 — CA-OR-8 is still single-pass despite being adjudicated as resolved

- **Severity:** Medium
- **Current behavior:** Buffered/non-streaming Continue constructs the combined prior assistant text plus provider fragment and calls `applyEditOutput` only once. The implementation explicitly calls this an accepted divergence (`server/fastify/src/prompt/assemble.ts:3114`), and its regression test expects exactly one invocation and a persisted `$editOutputCount` of `1` (`server/fastify/__tests__/generation.chat.test.ts:6473`). This contradicts the audit adjudication, which says CA-OR-8 was resolved by `8bf88e43c` and that append mode restored baseline pass semantics (`docs/audit/original-risu-compat-2026-08-12/ADJUDICATION.md:63`).
- **Baseline behavior:** The fork first runs `editoutput` on the raw completion fragment, then runs it again on the prior assistant text plus that fragment for Continue (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1631`).
- **Consequence and minimal repro:** Configure a buffered provider (`useStreaming: false`), an assistant tail of `A`, and an `editOutput` Lua listener that increments chat variable `editOutputCount`; then Continue with provider text ` +more`. Current persists `1`, while the baseline performs two passes and persists `2`. Put `Count={{getvar::editOutputCount}}` in a plain prompt-template card and send the next message: the outgoing prompt contains `Count=1` currently and `Count=2` at the fork point. A stateful edit-output transformation can also change the retained assistant history row itself, so this is not limited to an invisible hook count.
- **Classification:** `candidate-fix`
- **Confidence:** High

The lowest-risk parity direction is to restore the baseline's fragment pass followed by the combined-row pass for buffered Continue, then change the existing one-invocation regression. If retaining one pass is intentional, CA-OR-8 needs a new maintainer decision because its present `resolved` description is false.

## Areas swept and found clean

- **Context truncation and row selection:** When a provider request is dispatched, current final-budget trimming removes eligible history rows oldest-first and marks durable history truncation (`server/fastify/src/prompt/budgetFinalize.ts:60`), matching the fork's silent oldest-first removal (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1078`). Accepting the new confirmation therefore does not select different prompt rows from the fork. The atomic operation path currently bypasses the confirmation gate while the legacy route can return the confirmation conflict (`server/fastify/src/routes/generationChat.ts:5154`); that is a current feature-path inconsistency, not an Original-Risu payload divergence, because the fork had no confirmation gate and trimmed silently.
- **Continue boundary and history lifecycle:** For the normally reachable assistant-tail Continue flow, `useSayNothing` selects append versus extend, the transient boundary participates in assembly, and it is excluded from persistence (`server/fastify/src/prompt/assemble.ts:755`, `server/fastify/src/prompt/history.ts:489`). This matches the fork's `*says nothing*` boundary and Continue construction (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:170`). No additional role, order, identity, or persisted-history divergence was confirmed.
- **Lore CBS token counting:** Lore cutoff accounting expands CBS with `runVar: false` before tokenization (`server/fastify/src/prompt/lorebook.ts:183`) in both live assembly paths, while activation and final injection retain their existing semantics. This matches the final upstream `f6df8cb1e` port and the browser reference (`src/ts/process/lorebook.svelte.ts:812`).
- **Prompt-block roles:** `role`/`role2` normalization and application cover base description, author note/persona-style blocks, memory, lore, and final rendering (`src/ts/process/promptTemplateNormalization.ts:4`, `src/ts/process/promptBlockRole.ts:4`, `server/fastify/src/prompt/assemble.ts:2322`). The effective behavior matches the final upstream F2 sequence, including its later corrections; no intermediate upstream snapshot was treated as the target.
- **Protocol-v1 lifecycle:** Send, Continue, and Regenerate operations translate their stored intent into the ordinary generation input and use the shared assembler (`server/fastify/src/routes/generationOperations.ts:455`). Operation state and recovery bookkeeping did not change outgoing prompt text, role, or ordering relative to the corresponding normal action.
- **Sampler and provider payload ports:** GPT-5 capability tiers, Gemini thinking levels, Responses reasoning summaries, opt-in additional parameters, and streaming-field reset behavior matched their final upstream specifications. No default-setting or user-reachable wire-payload regression was found across the OpenAI Chat/Responses, Gemini, Bedrock, Ollama, and legacy dispatch paths inspected.

## Verification

- The server test suite completed with 149 files passing, 3,257 tests passing, and 1 skipped. The existing buffered-Continue test passed and thereby confirmed the current one-pass behavior rather than fork parity.
- The findings above were cross-checked against the current server assembler, retained browser implementation, fork-point worktree, post-fork upstream-port ledger, and focused regression tests.

## Could not verify

- No real-provider end-to-end wire capture was performed for every supported provider; provider conclusions are based on payload construction, dispatch code, and tests.
- Group-generation behavior was excluded by the brief's no-port boundary.
- API-only malformed/internal Continue states that the normal UI cannot initiate were not graded.
