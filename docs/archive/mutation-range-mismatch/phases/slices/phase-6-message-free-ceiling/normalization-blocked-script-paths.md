# Normalization-Blocked Script Paths

Status: implemented (verified at floor). Both routes are held at the
`message-free` floor and the blocking normalization is recorded; deeper
single-character-row narrowing stays blocked until
`normalizeScriptDefinitionDatabase` / `ensureCharacterCollection` are scoped to
validate-only. Proven by `commandMessageFreeCeiling.test.ts`.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 5 character script/trigger entries.
- `server/fastify/src/routes/commands.ts` - PUT characters/:id/scripts, PUT
  characters/:id/triggers.

## Scope

| Route | Blocker | Floor / unblock |
| --- | --- | --- |
| `PUT characters/:id/scripts` | `normalizeScriptDefinitionDatabase` + `ensureCharacterCollection` rewrite all characters + all modules + settings (`characterOrder`/`currentChar`) on every call. A single-character-row write would silently drop those repairs, and there is no helper for it. | `message-free-downgrade` only now. Verifier downgraded from the optimistic single-character-row claim: medium. |
| `PUT characters/:id/triggers` | Same normalization span as scripts. | `message-free-downgrade` only now. Verifier: low. |

The single-character-row fix (the audit's optimistic lever) requires
`normalizeScriptDefinitionDatabase` / `ensureCharacterCollection` to be scoped to
operate validate-only on siblings and write-through only the target character.
Module script/trigger routes already took the validate-only decision in Phase 4;
these character routes still need their own scoped write.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts` (helper choice).
- This phase keeps both routes at `message-free` and records the precise
  normalization that blocks a per-row write; it does not perform the
  normalization refactor.
- Revision/event behavior: unchanged from the current helper.
- Verified by `commandMessageFreeCeiling.test.ts`: both routes report
  `mutationPath: 'message-free'`, write exactly the broad set, and persist the
  replaced `customscript` / `triggerscript`.

## Done When

- The character script and trigger routes are at the `message-free` floor. (Done.)
- Each records the blocking normalization (`normalizeScriptDefinitionDatabase` +
  `ensureCharacterCollection`) and the unblock step (scope those passes to
  validate-only on siblings, write-through only the target character row). (Done.)
- No route here is narrowed to single-character-row in this plan. (Done.)

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
