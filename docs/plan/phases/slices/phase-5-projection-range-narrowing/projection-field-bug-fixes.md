# Projection Field-Bug Fixes

Status: implemented (`314af90f`). The `promptItem`/`persona`/`loadout` fixes
landed inline in Phase 4; the standalone `prompt` fix landed here — `prompt` no
longer maps to `['botPresets']` and is routed to the sprawling full-bootstrap
path (`SPRAWLING_FULL_PROJECTION_RESOURCES`), classified `sprawling`. Proven by
`projection.test.ts` ("falls back to full for a prompt-settings refresh" + the
classifier assertion).

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  "Pre-existing projection-field bugs".
- `server/fastify/src/routes/projection.ts` - `prompt`/`promptItem` (~45-46),
  `persona`, `loadout`.

## Scope

These resources ship the wrong field, so a foreign refresh never reflects the
changed state — independent of the write range, but fixed alongside it.

| Resource | Today | Fix |
| --- | --- | --- |
| `prompt` | `['botPresets']` | fall back to full/sprawling — `prompt-settings` writes 21 scattered settings scalars, not `botPresets`. |
| `promptItem` | `['botPresets']` | `['promptTemplate']` — the prompt-item commands write `promptTemplate`. |
| `persona` | `['personas','selectedPersona']` | add the legacy mirror scalars `username`/`userIcon`/`personaPrompt`/`userNote` that `select`/`delete` write via `mirrorLegacyProfile` (they read off the settings row). |
| `loadout` | `['loadouts']` | add `lastLoadedLoadoutName`, which `touch`/`delete` write. |

`prompt-settings` writes scattered settings scalars, so `prompt` should fall back
to full/sprawling rather than enumerate them; the other three are exact field
additions.

## Implementation Scope

- Source files: `server/fastify/src/routes/projection.ts`.
- `prompt`: route the resource to the sprawling/full path (no fixed field list).
- `promptItem`/`persona`/`loadout`: extend the field list to the fields the write
  actually changes.
- Non-scope: the writes themselves (Phases 2/4); the broad-array resource splits
  (other Phase 5 slices).

## Protocol Behavior

- A foreign refresh after each command reflects exactly the changed fields.
- `prompt` falling back to full is correct because its keys are scattered settings
  scalars; this matches the sprawling-by-design resources.

## Done When

- `prompt` no longer maps to `['botPresets']` (falls back to full); `promptItem`
  maps to `['promptTemplate']`; `persona` includes the mirror scalars; `loadout`
  includes `lastLoadedLoadoutName`.
- A projection test covers each: a foreign refresh reflects the changed field.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/server/projection.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
