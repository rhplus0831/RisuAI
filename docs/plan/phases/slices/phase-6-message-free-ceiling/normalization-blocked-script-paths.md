# Normalization-Blocked Script Paths

Status: planned. Blocked below the `message-free` floor until the
script-definition normalization is scoped to validate-only.

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 5 entries for 4171, 4205.
- `server/fastify/src/routes/commands.ts` - PUT characters/:id/scripts (4171), PUT
  characters/:id/triggers (4205).

## Scope

| Route (line) | Blocker | Floor / unblock |
| --- | --- | --- |
| `PUT characters/:id/scripts` (4171) | `normalizeScriptDefinitionDatabase` + `ensureCharacterCollection` rewrite **all** characters + **all** modules + settings (`characterOrder`/`currentChar`) on every call. A single-character-row write would silently drop those repairs, and there is no helper for it. | `message-free-downgrade` only now. Verifier downgraded from the optimistic single-character-row claim: medium. |
| `PUT characters/:id/triggers` (4205) | Same normalization span as 4171. | `message-free-downgrade` only now. Verifier: low. |

The single-character-row fix (the audit's optimistic lever) requires
`normalizeScriptDefinitionDatabase` / `ensureCharacterCollection` to be scoped to
operate validate-only on siblings and write-through only the target character —
the same refactor that unblocks the modules :id/scripts and :id/triggers routes
in Phase 4. Until that lands, these two stay at the floor.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts` (helper choice).
- This phase keeps both routes at `message-free` and records the precise
  normalization that blocks a per-row write; it does not perform the
  normalization refactor.
- Revision/event behavior: unchanged from the current helper.

## Done When

- 4171 and 4205 are at the `message-free` floor.
- Each records the blocking normalization (`normalizeScriptDefinitionDatabase` +
  `ensureCharacterCollection`) and the unblock step (scope those passes to
  validate-only on siblings, write-through only the target character row).
- No route here is narrowed to single-character-row in this plan.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
