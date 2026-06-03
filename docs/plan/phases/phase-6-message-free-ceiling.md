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
  characters/:id DELETE (orphan message rows leak without scoped targeted
  deletes), chats/:id DELETE (owning character row + chat rows + targeted message
  deletes), and modules/:id DELETE (`removeModuleReferences` spans characters +
  chats + two collection tables + settings).
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
