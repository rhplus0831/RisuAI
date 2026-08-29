# Phase 6 — Prompting, Generation, And Streaming

Status: Complete

Depends on: Phases 1-5

Completion anchors: `19ba37af26df7db60d7393976d61b520a785076b`,
`477a3aece1fffc159b0354fef5b21ecddf60cab5`

## Objective

Verify model-visible prompt assembly, transcript mutation, generation actions,
stream display, cancellation, failure, retry, reconnect/reattach, and final side
effects end to end.

## Closed Prompt And Stream Ownership

`ORC-SURFACE-100` closes the shared model-input boundary. The Phase 6
structural catalog owns all nine timed assembly stages and every retained
contributor: effective configuration, submit/edit transforms, Agent Preset
inputs, templates/roles, static/plain rows, history, lorebook, Hypa/BardWiki
memory, CBS variables, regex/Lua/triggers, biases, stop data, assets,
provider-ready messages, and final budget. It also closes the five actions,
nine retained generation styles, twelve durable operation states, five
finalization projections, seven completion effects, and thirteen protocol
events against production symbols.

The shared 16-cell compatibility fixture and its baseline/current goldens own
prompt rows, transcript roles and identity, provider-ready text, stream events,
and terminal output. Exact row order, role, content, named placement, stop
order, transcript identity, and output remain semantic; only generated ids and
timestamps may be normalized. Provider-specific request bodies, credentials,
capabilities, translation, and media dispatch remain Phase 7 ownership.

## Lifecycle State Table

`ORC-SURFACE-101` owns the durable generation and finalization outcomes below;
the rendered browser outcome remains cross-owned by verified Phase 4 row
`ORC-SURFACE-098`.

| Action or fault | Durable and user-visible outcome | Recovery/finalization owner |
| --- | --- | --- |
| Send; buffered or streamed success | One accepted user row and one stable assistant result; terminal buffered and streamed text agree. | Durable admission/job plus authoritative finalization. |
| Continue, append style | A new assistant row carries the continuation; disconnect or cancellation cannot replace the prior assistant. | Continue boundary id and finalization target precondition. |
| Continue, extend style | The existing assistant remains the target; a streamed cancellation persists the original text plus partial output on that same row. | Target snapshot and cancelled-partial finalization. |
| Regenerate and multi-result | Regenerate updates only the negotiated assistant; alternate candidates retain order and stable target identity across persistence/reload. | Target precondition, candidate persistence, reroll projection. |
| Edit-then-generate | Submit transforms and the edit are captured before dispatch, then finalized against that exact transcript snapshot. | Assembly submit snapshot and durable operation intent. |
| Preview and preview_prompt | The same contributor graph renders model-visible rows without appending or replacing transcript rows. | Read-only assembly route. |
| Provider failure before output, then Retry | The visible failure retains one accepted user row; billing-aware Retry performs exactly one new provider attempt and does not duplicate the user row. | Accepted-send recovery at `477a3aece`. |
| Partial failure or Stop | Any confirmed partial is committed or durably queued; cancellation moves through stopping to cancelled without reporting false success. | Job stop, finalization journal, replayable retry row. |
| Client disconnect or response loss | Provider execution continues after the viewer drops; the terminal result remains durable and can be recovered without redispatch. | Detached job, event replay, bootstrap projection. |
| Server restart or reattach | Active jobs expose replayable prompt/info and terminal disposition; completed/cancelled reattach closes without a leaked viewer. | Job registry, replay buffer, active-generation bootstrap. |
| Stale transcript or deleted continue/regenerate target | Finalization rejects the stale operation. Deletion after admission cannot recreate the target or mutate another row. | Transcript/target preconditions at authoritative commit. |
| Completion effects and queued finalization | Durable effects are idempotent, ephemeral effects remain live-only, recomputed state is derived, and queued cleanup is replayed exactly once. | Effect ledger and generation-finalization retry worker. |

The deterministic fault seams cover cancel-before-submit, partial cancellation,
same-chat contention, provider failure, dropped viewers, response loss, restart,
reattach, stale completion, target editing/deletion, SQLite finalization failure,
and retry replay. No production defect was exposed by the added extend-style
partial-cancel or admitted-target-deletion regressions.

All historical Category F obligations are independently re-verified against
the current owners and Phase 6 evidence. This includes decision rows
`ORC-SURFACE-009`, `011`-`015`, `019`, `021`-`022`, `026`, `032`, `034`, `036`,
`039`-`042`, and `044`-`047`, plus resolved-finding rows `064`, `068`-`069`,
and `074`. None remains merely mapped to historical evidence.

## Signed Boundaries

- Historical group generation remains a signed no-port under
  `ORC-DECISION-005`. `ORC-SURFACE-009` is now verified: browser prompt
  preflight rejects a group before prospective transcript mutation, legacy
  storage rejects group rows rather than deleting them, and the server route
  retains its explicit unsupported boundary.
- Baseline `Character.additionalText` retrieval split the field into paragraph
  blocks, selected the top three embedding-similar blocks, and inserted them in
  the description. RH+ commit
  `ec124302cbe49e718228322ca22b32a2ddf74d6e` explicitly retired that behavior.
  Signed `ORC-DECISION-061` and `ORC-SURFACE-102` preserve imported data, expose
  a read-only unsupported notice, remove the editor, and pin prompt omission.

## Browser And Differential Evidence

The production-bundle accepted-send matrix uses real Fastify routes, SQLite,
SSE, visible transcript controls, error/recovery UI, reload, and responsive
desktop/Pixel layouts. Eleven journeys pass, including partial/final display,
Stop, response loss, reconnect, restart, concurrent chats, queued finalization,
and the exact pre-token failure/Retry outcome at `477a3aece`. The separately
owned reroll reload/swipe journey remains verified under Phase 4.

The pinned differential passes all 16 baseline cells and 18 current/cluster
tests, compares all 16 cells, accounts for all 15 governed divergences, and
keeps cluster 10 healthy.

## Exit Criteria

- Model-visible inputs and durable/user-visible outputs match the governing
  obligation for every retained generation action.
- Buffered/streamed terminal results agree; `additionalText` omission and group
  rejection are individually signed exceptions.
- Cancellation/failure/recovery cannot mis-target, duplicate, recreate deleted
  targets, or silently lose transcript state or side effects.
- Focused generation/structure, built-browser, register, server typecheck,
  compatibility, formatting, and diff checks pass.

## Verification Evidence

- `19ba37af26df7db60d7393976d61b520a785076b` adds the closed structural catalog
  and focused durable regressions; the selected server files pass 71 tests.
- `477a3aece1fffc159b0354fef5b21ecddf60cab5` adds the visible pre-token failure
  then Retry proof; the complete accepted-send browser file passes 11 tests.
- Focused group-preflight/storage and retired-additional-information owner tests
  pass on the closure worktree.
- `pnpm check:server`, `pnpm test:compat-harness`, register validation,
  Prettier, and `git diff --check` pass at closure.
