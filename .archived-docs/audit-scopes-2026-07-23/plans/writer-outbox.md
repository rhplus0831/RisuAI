# Fix plan: writer-outbox (E-6 cross-tab order race)

This plan covers only the verified E-6 race. The implementation must preserve these existing contracts:

- Mutation rows and any new ordering metadata are scoped by `(writerSessionId, databaseLineage)`. `writerEpoch` remains
  authenticated row metadata, but it is not an ordering namespace or a disposal key. Rows belonging to another writer
  session stay dormant; do not delete them while preparing the current session.
- Do not broaden settlement. `acknowledgePendingMutation` remains an alias for `discardPendingMutation`, and outside
  explicit user cancellation only exact mutation-ID settlement may call it. An ordering fix must not infer acceptance
  from an epoch, a newer projection, or a larger order.
- Preserve `keyKind: 'subtle' | 'raw'` and the legacy rule that an absent `keyKind` means `subtle`. If the key scheme in
  an envelope is unusable, retain and warn about that row; never turn an ordering failure into silent deletion.
- Keep bootstrap's raw-row gate truthful: unresolved current-scope rows must continue to prevent authoritative
  hydration. Foreign-session rows remain dormant rather than becoming blockers for the current session.
- Any test that introduces a 423 response must call `resetWriterAccessLostForTests()` in `beforeEach`. The tests proposed
  below do not need a 423 and should not add one merely to exercise ordering.

The current failure has two distinct async boundaries. `stagePendingMutation` starts
`reservePendingMutationOrder()` immediately, and that helper commits/deletes an auto-increment marker in its own
transaction. `persistPendingMutation` later awaits key loading and AES-GCM encryption before opening the mutation-row
transaction. Therefore order `n` can be committed with no durable row, while another tab commits row `n + 1`, finds no
predecessor, dispatches an absolute value, and settles/deletes it; row `n` can then appear and replay the older value.
Commit `6a0b6c0b2` is the relevant precedent: it claims a mutation ID in memory before the asynchronous IndexedDB claim
so a second same-page dispatcher cannot become the winner. E-6 needs an origin-wide serialization point plus an
IndexedDB atomicity guarantee; another process-local set would not cover a second tab.

## Decisions required (user input)

None — approve the recommended atomic committed-order design below. It keeps order in the existing authenticated data,
does not discard or rewrite any old outbox row, and does not require a server/API migration.

## Candidate designs & trade-offs

### A. Atomically advance a committed-order counter and insert the encrypted row (recommended)

Queue persistence under a Web Lock shared by all tabs in the same `(writerSessionId, databaseLineage)` and requested
synchronously when `stagePendingMutation` starts. Inside that lock, read the next candidate order, encrypt with that
order using the existing AES-GCM additional data, then open one read-write transaction covering `orders` and
`mutations`. In that transaction, compare the current counter with the value used for encryption; if it still matches,
advance the counter and insert the mutation row together. If it changed, commit no write, generate a fresh IV, encrypt
again against a new candidate, and retry. Do not hold an IndexedDB transaction open across `subtle.encrypt`.

The existing `orders` store can hold an explicit, non-auto-generated counter key even though it was created with
`autoIncrement: true`. Use one counter record per `(writerSessionId, databaseLineage)`; do not include epoch. The counter
records the largest **committed row order**, not a reservation. Its update and the encrypted row are all-or-nothing.

- **Exact-race correctness:** tab A requests the scope's staging lock before any persistence await. A later tab B queues
  behind it. A commits counter `n` and row `n` in one transaction before releasing the lock; only then can B encrypt and
  commit row `n + 1`. B's dispatch already waits for `handle.ready`, so its predecessor scan cannot run until A's row is
  visible. The existing semantic/dependency Web Locks and `listPendingMutationPredecessors` then drain A before B. If
  A's live dispatcher races the drain, exact mutation-ID locking and the server receipt make it execute at most once.
  Thus B's absolute value is the last applied value and no lower-order row can materialize later.
- **Why encryption does not break atomicity:** the order is speculative while encryption runs; no order-store write has
  happened yet. Only IndexedDB request callbacks/promises may run after the final transaction is opened. In particular,
  queue the counter update, row put, and optional predecessor delete from IndexedDB success callbacks; never await
  WebCrypto, a timer, a lock, or unrelated promise from an active transaction. A counter race discards the ciphertext
  and retries with a new IV because AES-GCM nonce reuse is forbidden, even when the additional data/order changes.
- **Crash windows:** a crash before the final transaction leaves neither a counter advance nor a row. A crash/abort
  during it rolls both back. A crash after commit leaves a complete decryptable row that startup replays. Browser death
  releases the Web Lock, so a later tab can continue without an orphan reservation. These are the only three durable
  states; there is no committed “order only” state.
- **Migration/compatibility:** keep database version 3 and keep the current ciphertext/AAD format; no row rewrite is
  needed. When a scope has no counter record, derive the starting value from the maximum safe `order` among existing
  rows for that writer session and lineage across all epochs, then create the counter only in the same transaction that
  inserts the first new row. Old rows (including absent-`keyKind` subtle rows) continue through the existing decrypt and
  replay paths. Historical numeric auto-increment markers were inserted and deleted in one transaction, so none should
  be durable; ignore or warn on a malformed explicit counter instead of deleting mutation rows. Keep dormant scopes'
  counters inert.
- **Complexity/cost:** medium. It adds a small scope lock helper, a versioned counter record, a compare-and-swap retry,
  and transaction tests, but leaves dispatch, replay result classification, server receipts, and settlement semantics
  intact. The Web Lock is held across encryption, so same-scope staging in another tab waits for a potentially large
  payload; the 16 MiB payload limit bounds this and the lock must be scope-specific rather than origin-global.

Without `navigator.locks`, retain a same-page FIFO fallback and let the IndexedDB compare-and-swap choose commit order
between truly concurrent tabs. This still makes a late *lower numeric order* impossible, but overlapping tabs may be
linearized by encryption completion rather than UI initiation. That is the same legacy-browser boundary already
documented for cross-tab dependency locks. Do not pretend the process-local fallback is cross-tab protection; preserve
this limitation in code comments and tests. If the supported-browser policy requires initiation-order semantics without
Web Locks, choose design C instead and accept its durable-fence recovery machinery.

### B. Encrypt first, then allocate an order and insert without a staging lock

Change the envelope format so its AAD no longer contains `order`, perform encryption first, and then allocate the
auto-increment order plus insert the row in one transaction. An optional `aadVersion: 2` would distinguish new rows;
absent would mean the current order-bound format.

- **Exact-race correctness:** there can be no invisible lower order: the order and row commit together. However, with A
  paused in encryption and B completing first, B receives the lower order and A receives the higher order. Replaying A
  after B is internally consistent but can still make the visibly older absolute value win. This design closes the
  numeric anomaly by redefining concurrent order as encryption-completion order; it does not preserve the product's
  later-action-wins behavior in the reported interleaving.
- **Crash windows:** clean. A pre-transaction crash leaves nothing; an in-transaction crash leaves neither order nor
  row; a post-commit crash leaves the row. There are no orphan reservations.
- **Migration/compatibility:** add a per-row AAD/envelope version and decrypt absent-version rows with the exact current
  AAD including order. Never rewrite old ciphertext. New `keyKind` behavior remains unchanged. Excluding order from new
  AAD also stops cryptographically authenticating replay order, which is a meaningful integrity regression unless a
  separate authenticated commit token is introduced.
- **Complexity/cost:** low to medium, but the apparent simplicity hides both an envelope migration and a weaker order
  contract. Do not select it as the standalone fix.

### C. Persist reservation fences, then atomically replace each fence with its encrypted row

Keep the early auto-increment reservation, but retain a typed order-store record containing mutation ID, semantic key,
scope, sequence, and creation time. The encryption/finalization transaction would insert the mutation and delete the
matching fence together. Listing, predecessor discovery, dispatch marking, raw counting, and bootstrap would treat a
lower current-scope fence as a blocker, so a newer row could not dispatch while an older intent is still being prepared.

- **Exact-race correctness:** A's order-`n` fence is visible before B obtains `n + 1`. B either waits for A's row or
  remains retained without a network request. The fence-to-row handoff is atomic, so every committed order is always
  represented by one of them.
- **Crash windows:** a crash after fence creation but before encryption leaves an unreplayable fence with no payload.
  Safe recovery needs ownership/liveness: for example, hold a per-reservation Web Lock while preparing, let another tab
  delete the fence only after it acquires that lock, and make no-lock environments retain+warn rather than guessing by
  age. A TTL can restore liveness but can also evict a suspended live tab; returning `unavailable` is unsafe because the
  existing dispatcher may send the older mutation without a receipt. Returning `superseded` avoids the send but can
  silently lose the edit. This is the design's central cost.
- **Migration/compatibility:** version the order-store values. Existing mutation rows continue unchanged, and current
  code should have left no durable legacy numeric markers. Fence filtering must use writer session + lineage, never
  epoch; foreign-session fences stay dormant. Counts and bootstrap diagnostics must distinguish an unreadable encrypted
  row from a payload-less preparation fence.
- **Complexity/cost:** high. It touches every raw-row/replay/predecessor API, adds a new blocked state, cross-tab wakeup
  and orphan recovery, and expands the bootstrap gate. It preserves the earliest possible ordering point, but design A
  achieves the required behavior with fewer new durable states on browsers that provide Web Locks.

### D. Dispatch-time accepted-order tombstones/high-water marks

Allow reservations and rows to race, but atomically record the greatest started or accepted order per semantic key.
When a lower row appears later, suppress or discard it.

- **Exact-race correctness:** an accepted-order watermark can stop A after B is known accepted. A started-order fence can
  also stop A while B is in flight, but recovery must replay B first to determine whether its server receipt exists.
- **Crash windows:** the accepted watermark must commit with row completion and receipt-ACK creation. A crash after the
  server accepts B but before local settlement leaves an “uncertain” started fence; replay has to resolve B before any
  lower row. Clearing it early recreates E-6, while retaining it indefinitely blocks recovery.
- **Migration/compatibility:** old rows have no watermarks, so they must retain current replay behavior. New watermark
  records require scope and semantic-key migration rules, and foreign sessions must remain dormant. An unusable crypto
  row still cannot be discarded merely because a newer watermark exists.
- **Complexity/cost:** very high and semantically risky. A later sparse patch may not subsume an older same-key patch;
  discarding the older row can lose independent fields, while replaying it after B reverses order. It also pressures the
  exact-ID acknowledgement invariant. Reject this design unless semantic intents gain an explicit “supersedes” contract.

## Recommended design (detailed: files, functions, schema/migration)

Implement design A. The order assigned at the synchronous cross-tab staging-lock request is the normal serialization
order; the IndexedDB counter/row transaction is the durable linearization point. Do not add reservation fences,
dispatch watermarks, an AAD v2, or server-side fields.

### `src/ts/server/pendingMutationOutbox.ts`

1. Add a stored counter type such as
   `StoredPendingMutationOrderCounter { version: 1; writerSessionId; databaseLineage; lastCommittedOrder }` and a stable
   explicit IDB key derived from writer session + lineage. Validate every component and require a non-negative safe
   integer. Epoch must not appear in the key. Keep `OUTBOX_DATABASE_VERSION = 3`; the existing `orders` store accepts
   explicit keys and needs no structural upgrade.
2. Add `withPendingMutationStageLock(scope, task)`. Call `navigator.locks.request` immediately and exclusively with a
   name derived from the same two-part scope; keep a module-local promise-tail fallback only for same-page ordering.
   Requesting the lock must be the first asynchronous action started by persistence so tab B cannot get ahead while tab
   A loads a replacement handle or crypto key. Always release the local tail in `finally`. Recheck
   `pendingMutationScopeEquals(scope)` after lock acquisition and before commit.
3. Remove the `reservePendingMutationOrder()` call from `stagePendingMutation`, remove its promise parameter from
   `persistPendingMutation`, and delete the helper once no caller remains. `stagePendingMutation` must stay synchronous
   and continue returning a handle whose `ready` promise covers encryption and the atomic commit.
4. Split persistence into an outer locked/retry loop and a final commit helper:
   - Await an eligible replacement's `ready` inside the staging lock, preserving the current exact-handle and
     `dispatchStarted` rules.
   - Load the database/key, serialize and size-check the payload once, and read the scope's validated counter. If the
     counter is absent, compute the maximum safe order from durable mutation rows matching writer session + lineage
     across epochs. Let `candidateOrder = maximum + 1`, failing loudly/unavailable on safe-integer exhaustion.
   - Generate a fresh 12-byte IV and encrypt with the existing
     `mutationAdditionalData(semanticKey, mutationId, sequence, candidateOrder, scope)` before opening the final
     transaction.
   - Open one read-write transaction over `orders` and `mutations`. Re-read/initialize the counter (and legacy maximum
     when absent), verify it still yields `candidateOrder`, verify the mutation ID is absent, recheck scope, and inspect
     the replacement. In the same transaction put the counter, put the complete encrypted mutation row, and delete the
     exact unstarted replacement if eligible. Do not advance the counter on a scope change, duplicate ID, or retry.
   - Return a distinct internal `order-raced` result when another context changed the base. Complete/abort that
     transaction without writes, then loop with a new candidate and **new IV/ciphertext**. Only report `persisted` after
     `transactionDone` confirms both counter and row committed.
5. Preserve all post-commit behavior: replacement projection retirement, persistence activity, `dispatchStarted`,
   receipt ACK creation, raw row counting, and exact-ID discard/complete paths. They must not read the counter as proof
   of settlement. `replacePendingMutationIntentExact` already knows a committed fixed order; keep its current AAD and
   row transaction rather than routing it through order allocation.
6. Counter compatibility must be lazy and non-destructive. Do not rewrite old ciphertext or delete foreign-session
   rows/counters during `preparePendingMutationOutbox`. Leave counters intact when the test/support-only
   `clearPendingMutationOutbox` clears rows: an empty scope can safely continue at a higher order, and no clear/reset path
   should make a concurrently retained row appear newer than the counter. Production preparation must never reset a
   live scope's counter.

### Tests and documentation

- Extend `src/ts/server/pendingMutationOutbox.test.ts` for counter initialization, atomic abort, retry, old-row
  compatibility, scope/epoch behavior, and IV freshness. Its raw DB helpers should open version 3 and inspect the
  explicit order counter without modifying mutation ciphertext.
- Add a focused cross-tab test file (suggested
  `src/ts/server/pendingMutationOutbox.crossTab.test.ts`) if dynamic module isolation would make the scenario clearer.
  Two isolated imports must share one `IDBFactory`, crypto, and fake `navigator.locks`, but have separate module-local
  scope/lock state. Do not model two tabs merely with two handles sharing one process-local fallback.
- Extend `src/ts/server/durableMutationDispatch.test.ts` only for the end-to-end assertion that B cannot reach its
  network request before A is durable/drained, and that A is not sent again afterward. Keep the `6a0b6c0b2` duplicate
  same-ID regression intact.
- After implementation/tests pass, update `docs/structure/server-resources-and-bridges.md` to say that same-scope stage
  requests are cross-tab serialized and committed order advances atomically with row visibility. Mark E-6 closed in
  `docs/audit/writer-outbox.md` with the focused test evidence; do not change the other audit invariants.

No Fastify route, SQLite schema, command receipt, replay payload, or language file should change.

## Test plan

### Deterministic two-tab interleaving

Use `fake-indexeddb` plus a small deterministic exclusive Web Lock fake shared by two dynamically imported copies of the
outbox module. Each module calls `preparePendingMutationOutbox` with the same writer session, epoch, and lineage. Gate
tab A's first `crypto.subtle.encrypt` with a deferred promise after A has requested/acquired the staging lock:

1. Tab A stages absolute value `old`; do not pass a `previous` handle, matching independent tabs.
2. Wait until A is inside encryption. Tab B stages absolute value `new` and immediately calls
   `dispatchDurableMutation` with a network spy.
3. Before releasing A, assert B's `ready` is unsettled, the network spy is untouched, and raw IndexedDB contains neither
   an advanced committed counter nor a partial A row. This is the state in which current code exposes A's reserved order.
4. Release A. Assert A commits first, B commits second, both rows use increasing safe orders, and both decrypt. Let B's
   dispatcher continue. Assert predecessor replay sends/drains A before B's request, B is the final request, and a later
   attempt by A's original dispatcher observes its exact row already settled rather than sending it again.
5. Repeat with different epochs but the same writer session/lineage at the counter/lock layer: order remains monotonic
   and neither preparation nor migration deletes the old-epoch row. Keep replay assertions aligned with existing
   epoch-reclaim behavior rather than adding epoch as a disposal key.

This regression must fail against the current implementation: B becomes durable and reaches the request while A's
encryption gate is held, then A's lower-order row appears.

### Transaction conflict and crash recovery

Add a synchronous test-only transaction hook, reset by `resetPendingMutationOutboxForTests`, or patch the fake IDB
transaction in the test. The hook may abort after the counter put is queued but before transaction completion; it must
never introduce an awaited production callback inside the transaction.

- **CAS conflict:** bypass/partition only the test staging-lock fake so A and B read the same base. Pause A before final
  commit, let B commit, then release A. A must detect `order-raced`, use a different IV, re-encrypt with B's order + 1,
  and commit. There is never a lower order inserted after a higher committed order.
- **Crash/abort before commit:** fail A's encryption or abort its final transaction, simulating a tab dying before row
  publication. Assert neither its counter advance nor row survives. Release/close A's fake lock owner; B must acquire
  the lock and commit without waiting for a tombstone or timeout.
- **Crash after commit:** commit A, discard its module instance before dispatch, import a cold instance, prepare the same
  scope, and verify A is listed/decrypted/replayed normally. This proves the lock is coordination only and recovery
  depends on the row, not in-memory state.
- **Legacy migration:** create at least two pre-counter rows with the current v1 order-bound AAD (one absent-`keyKind`
  subtle envelope if the existing helper permits), then load the new code. The first new row must initialize the counter
  above the maximum legacy order; all old and new rows must remain listed in order and decrypt. Re-run the existing
  key-kind cases: a subtle row remains retained+warned when `SubtleCrypto` is unavailable, while tagged raw rows still
  round-trip in their supported environment. Do not invent an ordering-based disposal path for either scheme.
- **Settlement guard:** after B accepts, assert only B's exact `completePendingMutation` path removes B and creates its
  receipt ACK; counter advancement alone removes nothing. Foreign-session same-lineage rows remain raw/dormant through
  preparation and current-session replay.

Run the focused suite first:

```sh
pnpm test:frontend -- src/ts/server/pendingMutationOutbox.test.ts src/ts/server/pendingMutationOutbox.crossTab.test.ts src/ts/server/durableMutationDispatch.test.ts src/ts/server/pendingMutationReplay.test.ts
```

Then run the normal frontend verification:

```sh
pnpm format:check
pnpm check
pnpm test:frontend
```

## Risks

- Web Lock ordering is what preserves later-action-wins while encryption is pending. The lock request must be enqueued
  synchronously and keyed only by writer session + lineage; requesting it after key loading, including epoch, or using
  only a module-local tail recreates a cross-tab hole.
- The final IndexedDB transaction must not span WebCrypto. Browsers may auto-commit an IDB transaction once its request
  queue drains; fake-indexeddb can accidentally make an unsafe `await subtle.encrypt()` appear reliable.
- Every CAS retry needs a new AES-GCM IV. Reusing the IV after the candidate order/AAD changes is a cryptographic defect,
  not just a flaky-test concern.
- Lazy counter initialization must use the maximum durable order across all epochs for the exact writer session and
  lineage. Starting at zero, using `Date.now`, trusting the old auto-increment key generator, or keying by epoch can put a
  new row before retained compatible work.
- A scope lock held across a near-limit encryption adds head-of-line delay. Keep it scope-specific, preserve the payload
  limit, and do not move unrelated decryption/replay or network dispatch under it.
- A tab that is still running pre-fix JavaScript will not request the new stage lock or update the counter. The atomic
  commit prevents new-code partial publication but cannot make already-loaded old code participate. Treat mixed-version
  live tabs as a rollout risk (reload closes it); do not “solve” it by deleting unfamiliar rows.
- Do not let counter corruption or exhaustion fall through to ordinary replay/discard. Report persistence unavailable,
  retain any existing encrypted rows, and keep bootstrap's warning/gate behavior conservative.
