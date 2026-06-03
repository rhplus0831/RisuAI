# Normalization-Blocked Script Paths

Status: planned. Blocked below the `message-free` floor until the
script-definition normalization is scoped to validate-only.

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

## Done When

- The character script and trigger routes are at the `message-free` floor.
- Each records the blocking normalization (`normalizeScriptDefinitionDatabase` +
  `ensureCharacterCollection`) and the unblock step (scope those passes to
  validate-only on siblings, write-through only the target character row).
- No route here is narrowed to single-character-row in this plan.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
