# Lorebook Page Consumer Migration

Status: complete at `aaf66b75d`.

Parent: [Phase 2](../../phase-2-leaf-settings-and-collections.md)

Opening owner cursor: `e751edc69`.

## Objective

Move the standalone global-lorebook page pointer to `lorebookPageOwner` while
leaving lorebook collections, entry bodies, character/chat/module scopes, and
their compatibility bridges intact.

## Exact Scope

- Hydrate the owner from the existing focused standalone-setting route without
  adding a second request or widening shell/bootstrap payloads.
- Migrate page reads in global lorebook settings/list surfaces and prompt
  processing only where the pointer can be separated from the still-compatible
  lorebook collection.
- Route explicit page selection through the owner's accepted/queued/failed
  command contract and surface settlement where the UI initiates it.
- Move structural collection-operation page projections only when their stable
  lorebook-id semantics and current-attempt rollback remain unchanged.
- Retain and classify plugin/legacy compatibility exposure if external behavior
  prevents its removal in this slice.

## Safety Contract

- `loreBook` collection/body ownership does not move.
- No aggregate snapshot, common epoch, duplicate focused request, event delta,
  or payload widening is allowed.
- Queued selection stays visibly queued and reloads authoritatively after replay;
  failed current attempts roll back, superseded attempts do not.
- Collection create/delete/reorder behavior keeps stable-id selection repair.

## Removal Gate

Remove only the page-selection compatibility mutation path after every in-scope
consumer uses the owner. Keep the broader lorebook bridge and trusted-write
infrastructure until Phase 4/6. Every retained external/legacy page exposure
must have a named later-phase owner and closed-world probe.

## Validation

Focused owner, route hydration, lorebook bridge/process/UI, command/outbox, and
server settings-row tests; affected frontend/server lanes; browser smoke for
navigation, visible selection, reload, failure, and writer loss; payload and
reactive wakeup comparison; architecture/typecheck/format/diff gates.

## Done When

In-scope page reads and selection writes use the owner, no duplicate request or
reactive fanout regresses, the old page-selection dispatch is removed or held by
an explicit external compatibility probe, and every lorebook collection/body
path remains behaviorally unchanged.

## Completion

- The existing route and invalidation reads hydrate the owner without a second
  standalone-setting request, and observer teardown resets it explicitly.
- Normal UI and prompt-processing page reads use the owner. Explicit selection
  uses stable lorebook ids and exposes pending, queued, failed, retry, rollback,
  and authoritative-reload outcomes.
- The legacy `selectGlobalLorebook` and `dispatchSelectGlobalLorebook` mutation
  path is removed. Structural collection repair projects into the owner while
  the collection/body bridge remains intact.
- The legacy plugin key, the narrow database replica, and the cold
  prompt-processing fallback are retained as the named
  `client-lorebook-page-compatibility` surface with closed-world probes.
- Browser proof covers one focused hydration request, visible selection,
  accepted command persistence, and full reload. The implementation and
  inventory closed at `aaf66b75d`.
