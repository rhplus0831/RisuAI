# Phase 6: Prompting, Generation, And Streaming

Status: Complete on 2026-08-29; Phases 0-5 satisfied.

## Objective

Audit whether prompt and generation tests protect model-visible semantics,
terminal streaming behavior, cancellation, disconnect/recovery, and durable
transcript finalization across client, protocol, Fastify, and browser layers.

## Scope

- Prompt rows, history windows, lore/memory/template inputs, static/plain
  sections, token/preflight budgets, and golden fixtures.
- Generation operations, chat/completion routes, dispatch, streaming/non-stream
  parsing, terminal frame assertions, backpressure, body caps, and request abort.
- Atomic send, cancellation races, disconnect/reattach, finalization retry,
  operation replay, startup recovery, reroll/alternate persistence, and effects.
- Agent Preset execution and output composition where the primary contract is
  generation behavior.
- Shared generation protocol and the opt-in compatibility matrix.

Primary discovery guide:
[`prompting-generation-and-streaming.md`](../../../../docs/tests/prompting-generation-and-streaming.md).

## Audit Questions

- Do exact fixtures encode supported prompt semantics rather than incidental
  object shape or obsolete pre-Fastify behavior?
- Are SSE frame order, terminal uniqueness, error/cancel disposition, fragmented
  input, and slow-consumer bounds independently proved?
- Do tests distinguish committed, provisional, retrying, stalled, cancelled,
  and unconfirmed generation outcomes?
- Is duplicated client/server vocabulary protected by shared typed contracts or
  vulnerable to coordinated test drift?
- Does compatibility normalization preserve meaningful transcript and provider
  request differences?
- Is there sufficient built-browser proof for normal composer-to-stream-to-
  durable-reload behavior?

## Required Outputs

- End-to-end contract map from prompt inputs through provider request, stream,
  persistence, visible effects, and reload.
- Golden/fixture semantic ownership and intentional update rules.
- Findings for oracle-only tests, duplicate matrices, self-fulfilling provider
  mocks, terminal vocabulary drift, missing browser journeys, and ambiguous
  durability states.
- Compatibility verdict for every removal or semantic consolidation in scope.

## Exit Criteria

- Every Phase 6 test, fixture family, oracle, and compatibility owner has a
  disposition.
- Unique prompt, frame, cancel, disconnect, replay, finalization, and reroll
  contracts remain protected at faithful layers.
- Critical/High transcript-loss or false-terminal findings are resolved or
  explicitly gated.
- No golden is refreshed solely to accommodate cleanup.
- Count/fixture deltas and residual browser/parity gaps are recorded.

## Validation

- Focused client process/protocol and Fastify generation tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:server`
- `pnpm test:compat-harness` when prerequisites are available
- Relevant accepted-send/reroll browser specs, then `pnpm test:smoke`
- Isolated clone/load/backpressure gates where affected
- `pnpm format:check`
- `git diff --check`

## Completed Audit Record

Phase 6 opened with 93 category-F owners and 1,922 cases. The frozen opening
set passed before remediation: 990/990 frontend cases, 922/922 Fastify cases,
and 10/10 built-browser cases. Complete product-risk review moved 18 owners and
430 unchanged cases to A/B/C/D/E/G/I/K/L, most materially placing tokenizer and
provider-completion contracts in Phase 7. Fourteen new regression cases in the
opening owners and one routing-policy counterexample brought the live universe
to 700 files and 10,070 collected cases.

### End-To-End Contract And Disposition Map

Every opening file, complete case family, and disposition is recorded in
`inventory.json`. The following live F groups form the contract chain from
model-visible inputs through durable reload.

| Owner family | Live files / cases | Protected contract | Disposition |
| --- | ---: | --- | --- |
| Prompt assembly and budgeting | 30 / 784 | History, lore, retrieved descriptions, static/plain/template rows, provider-visible order, and context/preflight budgets | Keep |
| Streaming and response parsing | 10 / 253 | Fragmentation, UTF-8/CRLF framing, SSE and non-stream parsing, reader cleanup, cancellation, and terminal disposition | Keep |
| Durable generation lifecycle | 17 / 314 | Accepted identity, replay, reattach, finalization, provisional/terminal projection, reload, and browser recovery | 16 Keep / 1 earlier Reclassify |
| Effects and reroll | 12 / 91 | Stage-four/effect execution, alternate candidates, persistence, rollback, and reload-visible recovery | Keep |
| Agent Presets and Agent lore inputs | 6 / 64 | Input resolution, phase execution, cancellation, output composition, progress, and diagnostics | 4 Keep / 2 earlier Reclassify |
| Corrected product-risk owners | 18 / 430 | Routing, UI/settings, persistence bridge, provider/tokenizer, variable parsing, asset upload, and transport policy | Reclassify to A/B/C/D/E/G/I/K/L |

The current category-F set is therefore 75 owners and 1,506 cases: 24 frontend
Node owners with 164 cases, two Svelte+Node owners with ten cases, 32 DOM
owners with 620 cases, 15 Fastify owners with 701 cases, and two built-browser
owners with eleven cases. Phase 6 adds 72 Keep and 18 Reclassify decisions;
three owners reclassified into F by Phases 4/5 retain their earlier complete
dispositions. Live totals are 370 Keep, 33 Reclassify, and 297 Pending.

### Semantic Fixtures And Compatibility

- Route-backed prompt fixtures now compare the actual dispatched prompt with
  the local semantic expectation after removing only empty optional
  adornments. Client lore placement and retrieved-description owners exercise
  append/prepend/replace, ordering, parser, and position behavior.
- Client and Fastify budgeting now preserve token cost for surviving
  multimodal rows and include expanded character depth prompts in preflight.
  Returned prompt rows are re-tokenized and must fit input plus output inside
  the context limit.
- Provider fixtures remain controlled doubles, not real-provider network
  proof. The generic local golden remains separate from the exact server
  preview/dispatch owner. Neither golden nor compatibility normalization was
  refreshed.
- The pinned historical compatibility worktree is absent, so the current-only
  owner is green while differential claims remain blocked. No substitute
  checkout was used.

### Findings And Remediation

- `TSA-P06-001` fixes client/Fastify multimodal token under-accounting;
  `TSA-P06-009` budgets expanded depth prompts before dispatch.
- `TSA-P06-002` adds built-browser proof that an accepted send survives a lost
  operation response with exactly one provider call and one durable reply.
- `TSA-P06-003` through `TSA-P06-005` replace shape-only prompt confidence with
  route semantics, lore placement, and retrieved-description counterexamples.
- `TSA-P06-006` propagates parent Agent cancellation instead of reporting a
  timeout; `TSA-P06-007` rejects output keys duplicated across Agent phases.
- `TSA-P06-008` keeps later post-generation runs live while fencing stale
  terminal progress; `TSA-P06-010` cancels abandoned SSE readers.
- `TSA-P06-011` records all 18 product-risk routing corrections, and
  `TSA-P06-012` records why the retained prompt/protocol/Fastify/browser layers
  are distinct rather than duplicate by vocabulary.
- `TSA-P06-013` explicitly bounds Agent lore truncation policy, recovery without
  a lifecycle wakeup, malformed finalization journals, failed-effect retry,
  provider/browser fidelity, duplicated prompt walkers, and historical
  compatibility. Phase 12 owns runtime/journal observability, Phase 13 owns
  composition/parity additions, and Phase 14 must make the final residual
  decision.

All demonstrated High prompt-overflow, cancellation, output-ambiguity,
progress, and reader-lifecycle defects are fixed with regression proof. Review
rejected unsupported transcript-loss theories: finalization identity is stable
for supported sends, Fastify rejects non-vision inlays by policy, Fastify
`additionalText` omission is documented compatibility behavior, and the stream
registry has a single guarded terminal runner.

### Validation Summary

The exact completed opening set passed 1,001/1,001 frontend cases, 924/924
Fastify cases, and 11/11 browser cases after remediation. The complete frontend
universe passed 6,710/6,710 across 539 files; complete Fastify passed 3,318
cases with one intentional direct-only skip across 154 files. Focused prompt,
Agent, streaming, recovery, and routing owners passed at every change.

The performance, typecheck, smoke-build, affected-selection, inventory,
formatting, and diff gates are recorded in `latest-verification.md`. The full
compatibility harness remains prerequisite-blocked exactly as described above.
