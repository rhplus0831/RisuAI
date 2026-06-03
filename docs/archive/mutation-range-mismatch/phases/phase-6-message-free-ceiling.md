# Phase 6: Message-Free Ceiling

Status: implemented (floors verified). Each Tier-5 route is held at its safe floor
with its blocker and unblock condition recorded and a proving test; no route is
narrowed below the floor (the unblock steps are deferred prerequisites).

Goal: keep Tier-5 routes at their safe floor. A per-row write is blocked by a
cross-table span, message dependency, or normalization dependency. Record the
blocker and unblock condition; do not narrow deeper in this phase.

## Outcome

All nine Tier-5 routes already sat at their correct safe floor in code; Phase 6
verified each and corrected one over-optimistic seed-audit claim:

- `hydrated` (message-load dependency, cannot drop): `DELETE characters/:id` and
  `DELETE chats/:id` (orphan message/`hypa_v3` cleanup via `syncChatMessages` —
  there is no FK cascade and no message GC, so `message-free` would leak rows);
  `POST characters/:id/chats` (corpus-wide `messageIdExists` validation). The seed
  audit's "message-free floor now" for `DELETE chats/:id` was wrong and is
  corrected to `hydrated`.
- `message-free` (broad-set floor, deeper narrowing deferred): `DELETE
  modules/:id` (`removeModuleReferences` cross-table span), `POST characters`,
  `POST characters/create-and-select`, `POST modules`, `PUT
  characters/:id/scripts`, `PUT characters/:id/triggers`.

Proven by `server/fastify/__tests__/commandMessageFreeCeiling.test.ts` (9 tests):
each route asserts its `mutationPath` floor and passes the matching
`COMMAND_METRIC_REVIEW_GATES` gate; the deletes additionally prove the orphan
cleanup is load-bearing and the chats-create proves the corpus-wide validation.

## Source Anchors

- [`../mutation-range-mismatch.md`](../mutation-range-mismatch.md) - Tier 5.
- `server/fastify/src/routes/commands.ts` - the Tier-5 routes.
- `server/fastify/src/messageStore.ts` - targeted message deletes
  (`deleteChatMessages` / `deleteChatHypaV3`) needed before narrowing the deletes.

## Slices

All three slices are implemented (floors verified):

- [`message-dependent-delete-paths.md`](slices/phase-6-message-free-ceiling/message-dependent-delete-paths.md) -
  characters/:id DELETE and chats/:id DELETE both stay `hydrated` (orphan message
  rows leak without scoped targeted deletes), and modules/:id DELETE stays
  `message-free` (`removeModuleReferences` spans characters + chats + the loadouts
  collection + settings).
- [`message-validation-create-paths.md`](slices/phase-6-message-free-ceiling/message-validation-create-paths.md) -
  characters/:id/chats create (corpus-wide `messageIdExists` validation scan),
  characters create and create-and-select (append one row + settings, but
  existing-row id-repair side effects drop), and modules create (append one module
  row but global module/settings/character repairs must be scoped first).
- [`normalization-blocked-script-paths.md`](slices/phase-6-message-free-ceiling/normalization-blocked-script-paths.md) -
  characters/:id/scripts and characters/:id/triggers:
  `normalizeScriptDefinitionDatabase` + `ensureCharacterCollection` rewrite all
  characters + all modules + settings on every call; the single-row fix needs the
  normalization scoped first.

## Exit Criteria

- Each Tier-5 route is at the `message-free` floor (or stays `hydrated` where the
  message load is a real dependency, as noted per route). (Met.)
- Each route's slice records the precise blocker (orphan-row leak, corpus-wide
  message validation, cross-table reference strip, or global normalization) and
  the concrete unblock step (a targeted `deleteChatMessages`/`deleteChatHypaV3`,
  or scoping the normalization pass to validate-only). (Met.)
- No Tier-5 route is narrowed below the floor in this plan; doing so is gated on
  the unblock step landing first. (Met.)
- A proving test asserts every route's floor and gate
  (`commandMessageFreeCeiling.test.ts`). (Met.)

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
