# Fastify multi-chat and mobile audit work-priority index

Generated 2026-08-11 from the
[consolidated audit](fastify-multichat-mobile-stability-audit-2026-08-11.md)
and its ten reports under [`validate/`](validate/). The consolidated audit
recorded **10 primary findings**; the validation reports added concrete
consequences and adjacent findings, while the contextual review added seven
contextual observations, one explicit server-restart limitation, and two
destructive-operation concurrency questions. After de-duplicating shared root
causes, this index contains **28 active work items**, **8 resolved items**,
and **0 deferred items**.

The consolidated audit was recorded at `9afde4658ea5b277493e9d7f6ef7aaf387544165`.
Most validation reports checked the relevant paths again at
`e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`; this index was assembled at
`a2e7842dbc0929682e8bdefdfcbf563e2f9cf255`. Findings are point-in-time
evidence and must be re-verified against current code before implementation.

Status values: `Ready` — the report describes a bounded implementation and
test plan; `Needs design` — a state machine, protocol, durable schema, or
cross-layer contract must be designed first; `Needs decision` — product or
compatibility policy must be selected before implementation; `Deferred` —
valid work intentionally held outside the active order; `Resolved` — the item
has an implemented decision and regression coverage.

## Maintenance rules

- Before starting an item, re-verify its source report against current code and
  update its Status if the implementation or risk changed.
- Treat a tactical containment and its root fix as different deliverables. Do
  not close a root item merely because one caller or race window was contained.
- When an item is completed, move its row to **Completed items**, set Status to
  `Resolved`, and record the commit plus the regression tests in Resolution.
- When an item is intentionally deferred, move its row to **Deferred items**
  with a reason and a concrete revisit condition. Do not delete rows.
- A `Needs decision` item resolved by retaining current behavior still needs a
  regression pin, explicit user-facing/documentation treatment where relevant,
  and an accepted-divergence note.
- Shared protocol work must preserve the exact `operationId`, accepted message
  ID, job ID, writer/lineage, and stable chat target wherever the source rows
  require them. Chat ID alone is a concurrency scope, not operation ownership.
- Cross-layer fixes are complete only when their report-specific unit,
  Fastify-integration, and production-browser gates pass. Eventual hydration is
  not a substitute for an ordering or durability invariant.

## Priority rules

Each item appears in the highest applicable tier. A lower tier does not mean a
lower source-report severity; it means that a higher-priority data category was
not confirmed.

| Tier | Meaning |
| --- | --- |
| Tier 0 | Persistent-data safety and integrity: authoritative overwrite/loss, stranded durable intent, false durability claims, incorrect exported artifacts, or cancellation/recovery behavior that can durably commit the wrong result. |
| Tier 1 | Temporary user content and content-bound resident state: drafts, provisional message projections, resident transcripts, or their send-recovery controls can be lost, duplicated, or stuck while authoritative data remains safe. |
| Tier 2 | Mobile and reconnect stability: lifecycle, reattach, replay, progress, and production-browser recovery defects not already promoted by persistent-data impact. |
| Tier 3 | Remaining supported-feature correctness, compatibility, accessibility, and avoidable provider work. |
| Tier 4 | Defense-in-depth and policy tests for source-reachable but not yet reproduced failure modes. |

## Tier 0 — Persistent-data safety and integrity

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Fence restored legacy continue/regenerate retries before replay | [MS-05 A-5](validate/ms-05-generation-finalization-journal.md) | Ready | A pending retry restored from an old backup can replace a newer target message without an assembly-time freshness proof. | Decision 2026-08-11: quarantine/terminalize. Never replay a NULL-snapshot continue/regenerate row; mark it terminal (e.g. `stalled_legacy`) while preserving the row itself. Guard at sweep/replay time, not only at restore, because existing DBs may already contain NULL-snapshot rows. Add restore-plus-edit fault coverage. |
| Create one durable, idempotent accepted-send operation | [MS-01](validate/ms-01-accepted-send-recovery.md), [MS-02](validate/ms-02-chat-level-activity-is-not-operation-ownership.md) | Needs design | A user row can be durably accepted while the obligation to launch or recover its reply exists only in browser memory and disappears on reload or process eviction. | Add an operation/message identity before append, atomically persist append plus generation intent, and launch provider work after commit. This is the foundation for MS-02, MS-04, MS-07, and MS-10. Direction decided 2026-08-11: server-side atomic operation (single idempotent endpoint owning append+intent in one transaction); a client-only journal is rejected as the primary mechanism. |
| Carry exact send lineage through jobs and transfer same-chat ownership through handoff | [MS-02](validate/ms-02-chat-level-activity-is-not-operation-ownership.md), [MS-01 Addendum A](validate/ms-01-accepted-send-recovery.md), [MS-02 A-01](validate/ms-02-chat-level-activity-is-not-operation-ownership.md), [MS-07 retry addendum](validate/ms-07-recovered-job-warning-coexistence.md) | Needs design | An unrelated same-chat job or a newer user row can be credited to an older send; retry can clear the wrong recovery, and an early lease release permits duplicate sends. | Carry operation/message IDs through POST, job, SSE, bootstrap, reattach, finalization, and recovery. Transfer the preparation reservation until the exact operation owns a job, recovery, or terminal result. |
| Make Stop order-independent and acknowledged before and after job-ID delivery | [MS-04](validate/ms-04-pre-job-id-cancellation-gap.md), [MS-04 post-ID addendum](validate/ms-04-pre-job-id-cancellation-gap.md), [MS-08 AV-01](validate/ms-08-reattach-exhaustion.md) | Needs design | Stop can appear successful while the provider continues and a full or partial unwanted reply is later persisted. | Reuse the send operation identity; retain cancel-before-POST tombstones, persist unacknowledged Stop intent, return typed cancellation outcomes, and reconcile until the exact operation is absent or completed. UX decided 2026-08-11: explicit acknowledged "Stopping…" state with retryable failure, not optimistic instant stop. |
| Make finalization journaling and wire disposition phase-aware | [MS-05](validate/ms-05-generation-finalization-journal.md), [MS-05 A-3/A-4](validate/ms-05-generation-finalization-journal.md) | Ready | The server can claim `queued` with no retry row, silently lose a cancelled partial result, or report failure after the message already committed. | Track journal insert, authoritative commit, bookkeeping, and cleanup separately. Only a confirmed replayable row may emit `queued`; update client ownership, metrics, cancel finalization, and injected-failure tests together. |
| Reconstruct, render, and eventually settle real finalization-queue state | [MS-05 A-1/A-2/A-6](validate/ms-05-generation-finalization-journal.md) | Needs design | A legitimately provisional reply has no row indicator, so users can mistake it for durable data; its marker is lost on reload, it may disappear and reappear, and it can retry forever without a visible stalled policy. | Project writer-scoped pending/terminal retries through bootstrap or a resource, render the existing localized state, and decide bounded backoff plus terminal/stalled behavior. Policy decided 2026-08-11: capped exponential backoff, retry forever (no automatic give-up), visible stalled indicator after a failure threshold; rows are never silently deleted. |
| Make the complete durable terminal result canonical after replay gaps | [MS-03](validate/ms-03-bounded-replay-terminal-reconciliation.md) | Ready | After token eviction, the browser, plugins, and IGP can consume a truncated suffix; IGP can turn the bad projection into a durable message update. | Apply `done.result` as the final cumulative raw snapshot before stream closure and terminal consumers. Cover both replay caps, all modes, and changed/unchanged post-generation text. |
| Give cancelled jobs a non-success terminal disposition | [MS-03 additional issue A](validate/ms-03-bounded-replay-terminal-reconciliation.md) | Ready | A successfully cancelled job is reported as ordinary completion, so partial text can trigger IGP, plugin output listeners, notifications, and emotion work. | Add an additive cancelled outcome or protected terminal event; reconcile any persisted partial row without running success-only effects. Coordinate with the acknowledged Stop lifecycle. Note 2026-08-11: under the single-writer model the primary reachable observer is the same writer's own reattach after Stop-then-suspend/reload, not a second client; the acknowledged-Stop reconciliation also depends on this discriminator. |
| Prevent stale reattach restoration from outranking a newer same-chat job | [MS-02 A-03](validate/ms-02-chat-level-activity-is-not-operation-ownership.md) | Needs design | A failed stale reattach can be restored beside a newer job, causing Stop to target the stale job while the new job continues and persists. | First pin the timing sequence. Then make restoration projection-epoch-aware or at least same-chat-deduplicated; exact job cancellation must select the authoritative newer job. |
| Define the server-restart outcome for in-flight generation | [Explicit design limitation](fastify-multichat-mobile-stability-audit-2026-08-11.md#server-restart-loses-in-flight-generation-ownership) | Needs design | A restart loses the runner, replay, lock, and bootstrap projection after a send may already be durable. | Decision 2026-08-11: authoritative abandoned/retryable operation state (no automatic resume/regeneration; avoids double provider billing and surprise generation). On restart, ledger operations with no terminal result are marked abandoned and projected through bootstrap as a retryable state. Design depends on the accepted-send ledger. |
| Route every append-and-generate caller through one owned boundary | [MS-10 and addenda 1/3](validate/ms-10-auxiliary-send-recovery-bypass.md), [MS-02 A-02](validate/ms-02-chat-level-activity-is-not-operation-ownership.md) | Ready | DevTool Autopilot, PO multisend, and slash/STScript `/multisend` can leave accepted rows without replies or recovery; DevTool can also enter legacy reentrant generation. | Land the current-coordinator containment without waiting for the atomic endpoint, but keep the root item open. Await queued settlement and per-item outcome, preserve captured targets, order `/multisend clear`, and add an allowlist guard for raw generation callers. |
| Recover terminal-only durable and observable effects idempotently | [MS-06 AV-03](validate/ms-06-completion-reconciliation.md) | Needs design | A completion recovered only from the transcript can skip IGP and plugin automation, making interrupted and uninterrupted jobs produce different durable/observable outcomes. | Define an exact job/message effect ledger and per-effect idempotency. Decide explicit policies for ephemeral notification, TTS, and emotion work; prefer server ownership for durable effects. Policy decided 2026-08-11: durable/automation effects (IGP, plugin output listeners, translation) replay exactly-once via the effect ledger even when late; ephemeral notification/TTS/sound fire only on live terminals and are skipped on late recovery; emotion/image state recomputes from current state where possible. |
| Make optimistic character creation and import completion truthful | [Contextual optimistic-creation finding](fastify-multichat-mobile-stability-audit-2026-08-11.md#contextual-migration-spot-checks) | Ready | Non-selecting create/import returns an ID or index before durable settlement, so an apparently created character can later disappear after rollback. | Decision 2026-08-11: await and return the durable outcome (no queued/recovery state machine); creation/import reports success only after durable settlement. Test navigation, rejection, and caller-visible result semantics. |
| Prevent unsupported persistent trigger effects from masquerading as durable mutations | [Contextual trigger/CBS finding](fastify-multichat-mobile-stability-audit-2026-08-11.md#contextual-migration-spot-checks) | Ready | Visible character, persona, and lorebook effects can silently no-op, so users can believe persistent data changed when it did not. | Decision 2026-08-11: reject with explicit diagnostics, not implement. Surface unsupported-effect diagnostics at import/configuration time and a visible runtime warning instead of a silent no-op; keep imported definitions intact and preserve prior accepted retirements. Revisit per-effect implementation only if demand is demonstrated. |

## Tier 1 — Temporary and resident data

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Reconcile a replayed accepted append with the exact composer draft generation | [MS-01 Addendum B](validate/ms-01-accepted-send-recovery.md) | Ready | After reload, the accepted row can coexist with the same text restored as an unsent draft, inviting a duplicate resend. | Clear only the captured draft generation associated with the accepted operation; text equality is unsafe. Depends on durable operation identity and bootstrap/outbox reconciliation. |
| Apply authoritative completion reads before reporting success | [MS-06](validate/ms-06-completion-reconciliation.md), [MS-06 AV-02](validate/ms-06-completion-reconciliation.md) | Ready | The server row is safe, but the resident chat can remain user-only or partial while UI and Plugin V3 are told generation succeeded. | Build one fetch/freshness/apply/post-apply-verify barrier with revision, projection-epoch, range, and adjacency guards. Make strict hydration report the current request, not a historical cache bit. |
| Bound authority probes and always settle accepted-send recovery controls | [MS-06 AV-01](validate/ms-06-completion-reconciliation.md), [MS-08 AV-02](validate/ms-08-reattach-exhaustion.md) | Ready | A stalled bootstrap or transcript read can prevent the initial warning forever or leave Retry disabled indefinitely. | Use one bounded abort deadline, interpret timeout as authority unknown, retain recovery, and restore retryable UI state in `finally`. Test each never-settling read separately. |

## Tier 2 — Mobile and reconnect stability

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Reconcile accepted-send recovery with the exact discovered job | [MS-07](validate/ms-07-recovered-job-warning-coexistence.md) | Needs design | Foreground/online/page-show recovery can show “reply could not be started” and Retry beside the matching visibly running job. | Depends on Tier 0 lineage. Model `retryable -> owned_by_job -> completed`; suppress Retry only for an exact match and preserve warnings for unrelated same-chat locks. |
| Expose per-job reattach failure with exact Retry, Refresh, and Stop actions | [MS-08](validate/ms-08-reattach-exhaustion.md) | Ready | After retries exhaust, a dead observer still looks like healthy generation and blocks the chat with no recovery action, especially after mobile lifecycle transitions. | Add an observable job lifecycle and last error, exact-job manual actions, per-job bootstrap reconciliation, localized accessible UI, and warning-state sidebar treatment. Reuse typed cancellation from Tier 0. |
| Replace the Hypa progress scalar with an identified job projection | [MS-09](validate/ms-09-hypa-v3-global-progress.md), [MS-09 E/G](validate/ms-09-hypa-v3-global-progress.md) | Needs design | One job's terminal event hides another active job; labels/counts can describe the wrong chat and the global overlay is especially intrusive on mobile. | Keep full chat/job identity, derive active count and presentation from a normalized map, and share selectors with the modal. Localize and add status/accessibility semantics. Policy decided 2026-08-11: default presentation is the truthful global aggregate overlay; an accessibility-settings toggle switches to open-chat-only presentation with a compact indicator for other chats' active jobs. |
| Make Hypa startup/reconnect and refresh ordering authoritative | [MS-09 A-D](validate/ms-09-hypa-v3-global-progress.md) | Needs design | Missed live events can leave progress permanently absent/open, a stale GET can erase a newer active job, and an unbounded logical-ID fence can reject a recreated job. | Add a versioned active-job snapshot or equivalent buffered handoff, concrete job-instance identity, bounded terminal retention, stale-request fencing, and visibility for automatic pending enqueues. |
| Enforce hard durable replay budgets and an explicit gap/snapshot contract | [MS-03 additional issue B](validate/ms-03-bounded-replay-terminal-reconciliation.md) | Needs design | Protected frames can exceed advertised per-job limits, allowing detached jobs to create avoidable process-memory pressure; in-flight reconnect has no explicit gap signal. | Keep the Tier 0 terminal replacement as the immediate correctness fix. Separately compact replaceable frames, store/fetch oversized terminal snapshots, and enforce per-job plus aggregate bounds. |
| Build the production-stack desktop/mobile lifecycle matrix | [Browser/mobile coverage gap](fastify-multichat-mobile-stability-audit-2026-08-11.md#browsermobile-coverage-gap) | Ready | Existing tests do not exercise the process-loss, transport, concurrency, reattach, journal, and multi-job interleavings behind the findings. | Add deterministic fault seams and assert visible UI, resident projection, authoritative transcript, and remaining job/recovery/outbox state. Cover desktop, a mobile profile, fresh runtimes/process loss, and a physical-device pass before closing the workstream. |

## Tier 3 — Remaining feature correctness and compatibility

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Make remaining unsupported trigger/CBS paths explicit and non-throwing | [Contextual trigger/CBS finding](fastify-multichat-mobile-stability-audit-2026-08-11.md#contextual-migration-spot-checks) | Ready | Non-persistent effects can silently no-op and browser-context CBS callbacks can throw under Fastify. | Decision 2026-08-11: implement only the browser-language and screen-width CBS callbacks server-side, resolved from the last-reported client context; every other unsupported surface follows the persistent-effect policy (block with configuration/import diagnostics and visible runtime warnings). All server guards must be non-throwing so unsupported callbacks never crash generation. |
| Abort a running Hypa provider request when its job is cancelled | [MS-09 F](validate/ms-09-hypa-v3-global-progress.md) | Needs design | SQLite records cancellation while provider work can continue to consume tokens, quota, network, and time. | Track an abort handle per running job/batch, signal it from cancellation, and retain the commit-time cancelled-state guard. |

## Tier 4 — Defense-in-depth and policy tests

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Stress-test restore/import and backup snapshot atomicity before choosing a policy | [Destructive-operation assessment](fastify-multichat-mobile-stability-audit-2026-08-11.md#destructive-operation-assessment) | Ready | Ordinary commands may interleave with long replacement boundaries, and SQLite-plus-asset backups may capture mixed-time state. No current corruption was reproduced. | Add held-command/restore and concurrent-asset-write/backup stress tests. Promote a confirmed failure to Tier 0 and choose an operation-wide mutex or coherent snapshot policy only if the inference is reproduced. |
| Fault-inject failure between job registration, viewer attach, and runner tracking | [MS-04 hardening observations](validate/ms-04-pre-job-id-cancellation-gap.md) | Ready | Source ordering suggests a synchronous attach/write failure could leave a registered process-local job with no tracked runner, but it was not reproduced. | Add deterministic failures at each transition and assert abort, registry cleanup, and chat-slot release before deciding whether implementation changes are needed. |
| Decide consumer-only durable-stream cancellation semantics | [MS-04 hardening observations](validate/ms-04-pre-job-id-cancellation-gap.md) | Ready | Cancelling the returned token stream without the owner AbortSignal can detach local processing while the durable job continues. | Decision 2026-08-11: passive detach. Cancelling the consumer stream only detaches local observation; the durable job continues, and explicit cancellation flows solely through the acknowledged Stop lifecycle. Pin listener cleanup, progress, and server-job behavior with tests. |

## Completed items

Move finished active rows here with Status `Resolved`, a commit, and regression
coverage. Decisions to retain current behavior also belong here after they are
documented and pinned.

| Work item | Findings | Status | Impact | Resolution |
| --- | --- | --- | --- | --- |
| Retire character `additionalText` from Fastify prompt assembly without deleting imported data | [Contextual character-prompt observation](fastify-multichat-mobile-stability-audit-2026-08-11.md#contextual-migration-spot-checks) | Resolved | Characters relying on the legacy field receive a different prompt, but the divergence is intentional and imported data remains preserved. | Accepted divergence completed in `ec124302c`: the editor shows the unsupported retained field read-only and prompt omission has regression coverage; see the [archived work index](../../.archived-docs/audit/WORK-INDEX.md). |
| Require an exact assistant result before writing translated PO output | [MS-10 additional issue 2](validate/ms-10-auxiliary-send-recovery-bypass.md) | Resolved | A failed generation could export the source user row as if it were the translated assistant result. | Fixed in `53e59f420`: PO export requires `sendChat` success plus the assistant row adjacent to the exact accepted message ID in the captured chat, with strict forced hydration reconciliation when the projection is missing; success and download are suppressed on failure. Regression: `src/ts/process/files/multisend.test.ts` (adjacency, hydration fallback, failed generation, missing adjacent assistant). |
| Flush the final PO entry at end-of-file | [MS-10 additional issue 4](validate/ms-10-auxiliary-send-recovery-bypass.md) | Resolved | A valid final PO entry without a trailing blank separator was omitted, producing an incomplete exported artifact. | Fixed in `53e59f420`: the accumulated entry is flushed at EOF. Regression: `src/ts/process/files/multisend.test.ts` fixtures with and without trailing separators. |
| Fix the PO extracted-note marker typo | [MS-10 additional issue 5](validate/ms-10-auxiliary-send-recovery-bypass.md) | Resolved | `#. Note =` was recognized but `#. Notes =` was removed, leaving the marker in the model input. | Fixed in `53e59f420`: one normalized matcher (`/^#\. Notes? =/`) recognizes and removes both markers. Regression: `src/ts/process/files/multisend.test.ts` singular/plural marker fixtures. |
| Surface missing and orphaned assets in bundle-import results | [Contextual bundle-import finding](fastify-multichat-mobile-stability-audit-2026-08-11.md#contextual-migration-spot-checks) | Resolved | The browser announced success while dropping the server's report that imported persistent data had missing/orphaned assets. | Fixed in `23d3e98f6`: `importServerBundle` validates and propagates the server `assetReport`; the UI shows a localized qualified completion (clean, missing-reference caveat, orphaned-asset caveat, and combined with the discarded-queued-changes warning). Server import safeguards unchanged. Regression: `src/ts/server/backups.test.ts`, `src/ts/storage/backup.test.ts`. |
| Normalize the default/legacy Kobold URL | [Contextual Kobold finding](fastify-multichat-mobile-stability-audit-2026-08-11.md#contextual-migration-spot-checks) | Resolved | The repository default ending in `/api/v1` became `/api/v1/api/v1/generate`, so the default legacy provider could target an invalid endpoint. | Fixed in `59f4b3552`: the generate endpoint is joined segment-aware, deduplicating any overlapping suffix. Regression: `server/fastify/__tests__/kobold.test.ts` (bare host, intermediate `/api/v1`, full generate URL). |
| Implement or explicitly disable Ooba Legacy streaming | [Contextual Ooba finding](fastify-multichat-mobile-stability-audit-2026-08-11.md#contextual-migration-spot-checks) | Resolved | `useStreaming` was calculated but the adapter always used buffered HTTP, so a visible setting had no effect. | Decision 2026-08-11 implemented in `59f4b3552`: Ooba-Legacy-only configurations show unchecked disabled Streaming/Half-streaming controls plus a localized buffered-only compatibility notice; the retired WebSocket adapter stays retired, with the policy documented at the dispatch branch. Regression: `src/lib/Setting/Pages/BotSettings.pendingFlush.svelte.test.ts`, `src/ts/model/modelProfileUiState.test.ts`. |
| Support or explicitly diagnose standalone `CHAT` save blocks | [Contextual save-import finding](fastify-multichat-mobile-stability-audit-2026-08-11.md#contextual-migration-spot-checks) | Resolved | Saves using that compatibility block could not be imported and surfaced a raw error, although rejection was already atomic. | Documented import-time incompatibility per the 2026-08-11 decision, fixed in `43ac4a1cc`: typed `422 unsupported-standalone-chat-blocks` on the `.risu` and bundle import routes, localized browser diagnostic in every language pack, limitation documented in `README.md` and `docs/structure/assets-and-saves.md`, atomic validate-before-replace preserved. Regression: `server/fastify/__tests__/risuSaveImportRoute.test.ts`, `server/fastify/__tests__/risuSaveBundleImportRoute.test.ts`, `src/ts/server/backups.test.ts`, `src/ts/storage/backup.test.ts`. |

## Deferred items

No items are currently deferred. Move an active row here only after an explicit
decision and record a revisit trigger.

| Work item | Findings | Status | Impact | Deferral reason / revisit condition |
| --- | --- | --- | --- | --- |

## Suggested execution order

Tier position ranks user impact. Within a tier, execution should also minimize
the time that known corruption or false-durability paths remain open and should
reuse shared protocol work.

1. **Land the contained Tier 0 fixes first:** fence or quarantine unfenced
   restored retries; make finalization dispositions truthful; make
   `done.result` canonical; distinguish cancelled terminals; require exact PO
   output ownership; surface import asset loss; and fix EOF flushing. These do
   not need to wait for the larger accepted-send design.
2. **Design accepted send, lineage, and cancellation as one protocol program.**
   Settle the operation schema, idempotent append/launch boundary, exact job
   projection, cancel-before/after-POST semantics, and restart outcome
   together. Implement them as separately reviewable changes with the same
   identifiers and invariants.
3. **Contain all caller bypasses in parallel with that design.** Route DevTool,
   PO, and both `/multisend` paths through the current coordinator now, retain
   same-chat preparation ownership, and remove chat-level false-success
   inference. Migrate the containment to the durable endpoint when it lands.
4. **Close the remaining Tier 0 contracts.** Design idempotent recovery for
   terminal-only durable effects; make character create/import settlement
   truthful; and implement or reject persistent trigger mutations explicitly.
   Run the destructive-operation stress tests early and promote any reproduced
   data-integrity failure into this batch before selecting a lock/snapshot
   policy.
5. **Close resident-state truthfulness next.** Apply completion reads before
   success, bound authority probes, reconcile drafts, and project legitimate
   finalization queues. Then connect exact accepted-send recoveries to exact
   running jobs.
6. **Finish mobile lifecycle state:** expose reattach failure/actions, rebuild
   Hypa progress around authoritative job identity, and enforce the replay
   snapshot/budget contract. Scaffold deterministic browser fault seams early
   and use the full lifecycle matrix as the acceptance gate for every preceding
   batch.
7. **Take Tier 3 by subsystem:** provider transport fixes, save/script
   compatibility decisions, PO parser cleanup, then memory-job cancellation.
   Run Tier 4 fault tests opportunistically when the adjacent generation
   lifecycle code is already under change.

## Source coverage and non-work observations

- The ten validation reports are the detailed evidence base; primary IDs and
  addenda in the tables link directly to those reports. Shared causes are
  intentionally represented by one implementation row with multiple finding
  links rather than repeated in every tier.
- The consolidated audit's verified safeguards and negative findings are not
  work items: cross-chat activity is stable-target keyed, the server enforces
  one running job per chat, most asynchronous writes have stable ownership,
  typed same-chat 409 remains retryable, durable command replay is ordered and
  idempotent, and normal finalization is snapshot-fenced.
- No destructive import defect was confirmed. The Tier 4 destructive-operation
  validation row preserves only the audit's two explicit concurrency questions and
  requires reproduction before a locking policy is chosen.
- Existing exit criteria are acceptance conditions on the corresponding rows,
  not separate work items. The workstream closes only when every accepted send
  has an exact durable outcome, every ownership decision is operation-specific,
  terminal text matches authority before callbacks, Stop is honored across the
  pre-header window, `queued` always has a durable row, and the production
  browser matrix passes.

Co-Authored-By: Codex <noreply@openai.com>
