# Message-Validation And Create Paths

Status: implemented (verified at floor). Each route is held at its safe floor and
its blocker is proven by `commandMessageFreeCeiling.test.ts`. Deeper narrowing
stays blocked by the corpus-wide message-validation scan (chats create) or the
dropped id-repair / global-repair side effects (character + module create).

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 5 create/validation entries.
- `server/fastify/src/routes/commands.ts` - POST characters/:id/chats, POST
  characters, POST characters/create-and-select, POST modules.

## Scope

| Route | Blocker | Floor / unblock |
| --- | --- | --- |
| `POST characters/:id/chats` | The duplicate message-id validation (`messageIdExists`) scans every chat's `message[]` corpus-wide, so the message load is a real validation dependency; `unshift` + multi-character normalization rewrite multiple character/chat rows. | Drop only the nine-collection + settings rewrite (stays message-aware); keep the message load. Verifier: low. |
| `POST characters` | Append one character row + settings (`characterOrder` always appended, `currentChar` clamped), but existing-row id-repair side effects are dropped. | Feasible as `INSERT` + settings, but start with `message-free-downgrade`. Verifier: high. |
| `POST characters/create-and-select` | Same as character create, plus the selection clamp. | `message-free-downgrade` first. Verifier: medium. |
| `POST modules` | Appends one module row, but `ensureModuleCommandDatabase` can repair existing module ids, `enabledModules`, and character collection shape before the append. | Feasible as append-to-`modules` once those repairs are validate-only or explicitly co-written; keep the `message-free` floor for now. Verifier: high. |

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts` (helper choice).
- characters/:id/chats create stays `hydrated`: the corpus-wide `messageIdExists`
  scan is a real message-load dependency. The deeper narrowing (drop the
  nine-collection + settings rewrite) is deferred — the route is at its floor.
- characters create/create-and-select stay at the `message-free` floor; the
  eventual `INSERT` + settings narrowing must explicitly accept dropping
  existing-row id repairs (Prerequisite 2) and is recorded but not done here.
- modules create stays at the `message-free` floor; the eventual append-only
  module write must scope `ensureModuleRecords`, `ensureEnabledModules`, and
  `ensureCharacterCollection` repairs.
- Revision/event behavior: unchanged from the current helper.
- Verified by `commandMessageFreeCeiling.test.ts`: the chats-create route reports
  `mutationPath: 'hydrated'` and rejects a message id that already lives in a
  different character's chat (proving the corpus-wide validation dependency); the
  three creates report `message-free` and write exactly the broad set.

## Done When

- characters/:id/chats create retains the message-id validation at the `hydrated`
  floor; the deeper collection/settings drop is recorded as the unblock. (Done.)
- characters create/create-and-select are at the `message-free` floor with the
  `INSERT` + settings target and the dropped-id-repair caveat recorded. (Done.)
- modules create is at the `message-free` floor with the append-to-`modules`
  target and global repair blockers recorded. (Done.)
- No route here is narrowed below the floor in this plan. (Done.)

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
