# Phase 6: Message-Free Ceiling

Status: planned. Blocked: each route here needs a prerequisite scoped before its
deeper narrowing is safe.

Goal: keep Tier-5 routes at their safe floor. A per-row write is blocked by a
cross-table span, message dependency, or normalization dependency. Record the
blocker and unblock condition; do not narrow deeper in this phase.

## Source Anchors

- [`../mutation-range-mismatch.md`](../mutation-range-mismatch.md) - Tier 5.
- `server/fastify/src/routes/commands.ts` - the Tier-5 routes.
- `server/fastify/src/messageStore.ts` - targeted message deletes
  (`deleteChatMessages` / `deleteChatHypaV3`) needed before narrowing the deletes.

## Slices

- [`message-dependent-delete-paths.md`](slices/phase-6-message-free-ceiling/message-dependent-delete-paths.md) -
  characters/:id DELETE (2390, orphan message rows leak without a targeted
  delete), chats/:id DELETE (2617, scoped to the owning character's row + its
  chat rows + a targeted message delete), modules/:id DELETE (3673,
  `removeModuleReferences` spans characters + chats + two collection tables +
  settings).
- [`message-validation-create-paths.md`](slices/phase-6-message-free-ceiling/message-validation-create-paths.md) -
  characters/:id/chats create (2495, corpus-wide `messageIdExists` validation
  scan), characters create (2273) and create-and-select (2310, append one row +
  settings, but existing-row id-repair side effects drop).
- [`normalization-blocked-script-paths.md`](slices/phase-6-message-free-ceiling/normalization-blocked-script-paths.md) -
  characters/:id/scripts (4171) and characters/:id/triggers (4205):
  `normalizeScriptDefinitionDatabase` + `ensureCharacterCollection` rewrite all
  characters + all modules + settings on every call; the single-row fix needs the
  normalization scoped first.

## Exit Criteria

- Each Tier-5 route is at the `message-free` floor (or stays `hydrated` where the
  message load is a real dependency, as noted per route).
- Each route's slice records the precise blocker (orphan-row leak, corpus-wide
  message validation, cross-table reference strip, or global normalization) and
  the concrete unblock step (a targeted `deleteChatMessages`/`deleteChatHypaV3`,
  or scoping the normalization pass to validate-only).
- No Tier-5 route is narrowed below the floor in this plan; doing so is gated on
  the unblock step landing first.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
