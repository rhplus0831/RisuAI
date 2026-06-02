# Message-Validation And Create Paths

Status: planned. Blocked below the `message-free` floor by a corpus-wide message
validation scan or dropped id-repair side effects.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 5 entries for 2495, 2273, 2310.
- `server/fastify/src/routes/commands.ts` - POST characters/:id/chats (2495), POST
  characters (2273), POST characters/create-and-select (2310).

## Scope

| Route (line) | Blocker | Floor / unblock |
| --- | --- | --- |
| `POST characters/:id/chats` (2495) | The duplicate message-id validation (`messageIdExists`) scans every chat's `message[]` corpus-wide, so the message load is a real validation dependency; `unshift` + multi-character normalization rewrite multiple character/chat rows. | Drop only the nine-collection + settings rewrite (stays message-aware); keep the message load. Verifier: low. |
| `POST characters` (2273) | Append one character row + settings (`characterOrder` always appended, `currentChar` clamped), but existing-row id-repair side effects are dropped. | Feasible as `INSERT` + settings, but start with `message-free-downgrade`. Verifier: high. |
| `POST characters/create-and-select` (2310) | As 2273, plus the selection clamp. | `message-free-downgrade` first. Verifier: medium. |

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts` (helper choice).
- 2495 keeps its corpus-wide message validation; only the nine-collection +
  settings rewrite is dropped (it stays off the per-row target).
- 2273/2310 start at the `message-free` floor; the eventual `INSERT` + settings
  narrowing must explicitly accept dropping existing-row id repairs (Prerequisite
  2) and is recorded but not done here.
- Revision/event behavior: unchanged from the current helper.

## Done When

- 2495 retains the message-id validation and drops the collection/settings
  rewrite where safe.
- 2273/2310 are at the `message-free` floor with the `INSERT` + settings target
  and the dropped-id-repair caveat recorded.
- No route here is narrowed below the floor in this plan.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
