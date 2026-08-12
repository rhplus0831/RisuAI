# Stage 3 differential golden-transcript harness

Date: 2026-08-12  
Baseline: `/home/codex/risu-baseline-71c476e9c` at `71c476e9c86263fe907105b011ca4dde0a619d66`  
Command: `pnpm test:compat-harness`

## Result

The first golden run completed all 16 solo-chat cells:

- 16/16 cells have at least one baseline/current difference.
- 15/16 have a persisted-transcript difference.
- 16/16 have an outgoing-provider-request difference.
- 6/16 have an execution/result-count difference.
- Both cluster 10 mechanisms reproduced under explicit fault seams.

The machine-readable artifacts are:

- `test/compat-harness/golden/baseline.json`
- `test/compat-harness/golden/current.json`
- `test/compat-harness/golden/diff.json`
- `test/compat-harness/golden/cluster10.json`

The apparently broad request result has one common cause: for every cell that reaches OpenAI, the message array and sampler values match, but the same legacy `aiModel: "gpt4o"` fixture resolves to wire model `gpt-4o` in Original and wire model `gpt4o` after the current import/profile path. Empty-send/off has no current request, and multisend has one Original request versus two current requests.

## Feasibility spike and boundary

Driving the exported Original `sendChat` pipeline under Vitest is feasible with the baseline's dependencies installed and a happy-dom/Vite/Svelte environment. The harness executes real Original prompt assembly, tokenizer boundary, OpenAI request adapter, buffered/SSE response handling, and final logical database transcript mutation. It also executes the real exported `/multisend` command.

The unexported Svelte component action methods are not a stable callable boundary. Consequently:

- Original empty-send marker creation and regenerate tail truncation are emulated immediately before real `sendChat` execution.
- Current empty-send/on uses the exported durable append command followed by real `sendChat`; regenerate uses the exported durable truncate command followed by real `sendChat`.
- `/multisend` is executed through the real exported command implementation on both sides.
- The Original artifact is the final database projection mutated by the client pipeline, not an IndexedDB serialization/rehydration test.
- The current artifact is read back from the in-process Fastify SQLite message route after terminal reconciliation.
- DOM rendering, composer clearing, reroll-menu state, IndexedDB mechanics, browser reload, and group generation are outside this boundary. Group generation is the documented no-port and is intentionally absent.

Provider requests are captured at the actual OpenAI `fetch` boundary. Both sides receive the same deterministic buffered JSON or OpenAI-style SSE reply. Authentication values are redacted, generated identifiers are normalized by first semantic occurrence, timestamps are reduced to presence, and JSON object keys are canonicalized. Message-array order and all provider payload values remain exact.

## Divergence inventory

Legend: `E` execution/result-count, `T` persisted transcript, `R` provider request.

| Cell | Diff | Ledger mapping / result |
|---|---:|---|
| `send__buffered__say-off` | E/T/R | **NEW-H1**: current rejects an empty send whose tail is assistant when say-nothing is off; Original dispatches and appends a reply. **NEW-H2** follows because current has no request. |
| `send__buffered__say-on` | T/R | Cluster 28 (current durable protocol/effect-ledger `generationInfo` keys); **NEW-H2** wire model ID. Visible role/data rows match. |
| `send__streamed__say-off` | E/T/R | **NEW-H1** and **NEW-H2**, same as buffered. |
| `send__streamed__say-on` | T/R | Cluster 28; **NEW-H2**. Visible role/data rows match. |
| `regenerate__buffered__say-off` | T/R | Cluster 28; **NEW-H2**. Replacement role/data and normalized generated row ID match. |
| `regenerate__buffered__say-on` | T/R | Cluster 28; **NEW-H2**. |
| `regenerate__streamed__say-off` | T/R | Cluster 28; **NEW-H2**. |
| `regenerate__streamed__say-on` | T/R | Cluster 28; **NEW-H2**. |
| `continue__buffered__say-off` | T/R | Cluster 13: Original remints the assistant row/generation identity; current extends the existing canonical row and preserves its ID. **NEW-H2**. |
| `continue__buffered__say-on` | T/R | Cluster 28 only at the final-row metadata surface; visible append-mode role/data match. **NEW-H2**. |
| `continue__streamed__say-off` | R | Persisted transcript is the sole exact transcript match in the matrix. **NEW-H2**. |
| `continue__streamed__say-on` | T/R | Cluster 11: Original persists the extended say-nothing row with role `user`; current persists a new `char` row. Also cluster 28 and **NEW-H2**. |
| `multisend__buffered__say-off` | E/T/R | Clusters 20, 28, and 29; **NEW-H2**; **NEW-H3** below. |
| `multisend__buffered__say-on` | E/T/R | Clusters 20, 28, and 29; **NEW-H2**; **NEW-H3**. The toggle does not affect explicit multisend turns. |
| `multisend__streamed__say-off` | E/T/R | Clusters 20, 28, and 29; **NEW-H2**; **NEW-H3**. |
| `multisend__streamed__say-on` | E/T/R | Clusters 20, 28, and 29; **NEW-H2**; **NEW-H3**. |

New findings from this run:

- **NEW-H1 — empty send without say-nothing:** Original permits an empty send after an assistant tail and generates another assistant row. Current returns the server preflight error `Server prompt assembly for a send requires the last message to be a text user message.` This is not described by the existing ledger.
- **NEW-H2 — imported legacy OpenAI model selector leaks to the wire:** Original maps legacy model ID `gpt4o` to `gpt-4o`; current sends `gpt4o`. The remainder of the single-call payloads is semantically equal for this fixture. This is not described by the existing ledger.
- **NEW-H3 — ordinary two-entry Original multisend stops after entry one at the exported command boundary:** Original's first send replaces the database/chat projection; the command retains its earlier `currentChat` reference, and the second send fails before the provider boundary. Current persists and generates both entries. This is adjacent to cluster 20, but its no-injected-failure direction is more specific than the ledger claim and should receive a UI-level confirmation before cluster 20 is rewritten.

Cluster 12 is not exercised by the happy-path matrix because its observable is a failed/cancelled append-mode Continue boundary. Cluster 10 is exercised separately below. The current multisend `time` and client-minted IDs corroborate cluster 29.

## Cluster 10 fault seams

### Replay-cap eviction of the prompt

**Reproduced.** A durable `JobRegistry` was configured with `replayMaxEvents: 1`, then given `prompt`, `info`, and a canonical `done` containing `Canonical terminal reply.` The terminal was successfully written to the side-channel snapshot. Reattach received:

1. `replay_gap`
2. `info`
3. terminal-snapshot `done` reference

The prompt had been evicted. `requestServerChatGeneration` fetched the intact canonical terminal snapshot but still returned `status: "error"` with `stream ended without a prompt event`, because readiness requires both prompt and info.

This fault cap is deliberately smaller than the essential prompt+info set. Normal configured caps preferentially preserve essential frames; the reproduction proves the fallback eviction/client-consumption mechanism when the essential set itself cannot fit, not the frequency of that condition in production.

### Retried extend-Continue transient duplicate

**Reproduced.** The first extend-Continue consumer applied ` Continued reply.` to `Seed answer.` and then received an injected transport error. A second consumer for the same reattach replay captured the already-partial row as its new prefix and replayed the same cumulative partial:

- after attempt one: `Seed answer. Continued reply.`
- during retry: `Seed answer. Continued reply. Continued reply.`
- canonical terminal: `Seed answer. Continued reply.`
- after terminal reconciliation: `Seed answer. Continued reply.`

The duplicate is therefore transient and is healed by the canonical terminal patch, matching the cluster's stated display class. Both cluster 10 claims now have executable reproductions and can move from `PLAUSIBLE` to reproduced/confirmed for fix-queue adjudication.

## Running and updating

`pnpm test:compat-harness` validates the baseline worktree commit before running and compares all four generated artifacts with the committed goldens. If baseline dependencies are absent, install them only in the baseline worktree with:

```sh
pnpm --dir /home/codex/risu-baseline-71c476e9c install --frozen-lockfile
```

After an intentional compatibility decision, refresh the artifacts with:

```sh
UPDATE_COMPAT_HARNESS=1 pnpm test:compat-harness
```

The baseline path is intentionally pinned to the audit worktree above so the harness cannot silently compare against another RisuAI checkout.
