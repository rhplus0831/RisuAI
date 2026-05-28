# Codex Audit: Phase 9 Client Thinning

Date: 2026-05-28
Branch reviewed: `fastify`
HEAD reviewed: `8d63dfa4 fix: add client thinning invariant audit`

## Scope

This audit checked whether the Phase 9 / client-thinning work was completed
properly against the current docs, codebase, and recent commit history. The
review used the Phase 9 docs, the `docs/fastify/client-thinning` closeout docs,
server and client command paths, import/export paths, and the committed
verification ladder.

## Conclusion

Phase 9's original migration work appears broadly implemented, but the current
Phase 9 / client-thinning closeout is not complete as written. The most
important gap is that EC4/EC7 claim public command create paths require
client-supplied ids and never mint ids, while current public command helpers
still call `randomUUID()` for several root resources. The committed audit script
passes because it checks a narrower set of helper functions.

## Findings

### P1: EC4/EC7 are not actually closed because public create commands still mint ids

The current exit criteria require command-path identity helpers to reject missing
ids and state that create commands require client-supplied ids:

- `docs/fastify/client-thinning/README.md:59`
- `docs/fastify/client-thinning/decisions.md:83`
- `docs/fastify/client-thinning/decisions.md:91`

However, current public command helpers still fall back to `randomUUID()`:

- `server/fastify/src/commands/characters.ts:111`
- `server/fastify/src/commands/presets.ts:163`
- `server/fastify/src/commands/personas.ts:57`
- `server/fastify/src/commands/chats.ts:116`
- `server/fastify/src/commands/chats.ts:127`
- `server/fastify/src/commands/modules.ts:68`
- `server/fastify/src/commands/lorebooks.ts:134`
- `server/fastify/src/commands/translatorPresets.ts:70`

The route layer calls these helpers from public command endpoints, for example
`server/fastify/src/routes/commands.ts:1018` for preset creation.

The committed invariant audit does not cover these root create helpers. It only
checks a narrower list in `util/client-thinning-audit.ts:215`, covering prompt
items, messages, lorebook entries, and scripts/triggers.

Manual reproduction confirmed the gap: posting to `/api/v1/commands/presets`
with a missing `preset.id` returned `200` and a server-generated UUID in
`presetId`.

Impact: the docs, tests, and audit claim a stable-id invariant that the current
public command API does not enforce.

### P2: JSON import can create state that block export rejects

The JSON import route calls the `.risu` import normalizer:

- `server/fastify/src/routes/save.ts:66`

But the normalizer only creates some top-level collections when related keys are
present:

- `server/fastify/src/risuSave/importSnapshot.ts:155`

The route test explicitly accepts a minimal JSON import:

- `server/fastify/__tests__/risuSaveImportRoute.test.ts:94`

Block export then requires normalized top-level arrays such as
`database.botPresets`:

- `server/fastify/src/risuSave/exportSnapshot.ts:62`

Manual reproduction confirmed the gap: importing `{ "database": { "v": 1 } }`
succeeded, then exporting with `envelope=risusave-blocks` failed with `400` and
`database.botPresets must be an array`.

Impact: EC3 says imports should produce current-shape data, but the JSON import
path can still leave the server with a shape that public export cannot handle.

### P2: Chat folder ids are created per character but patched and deleted globally

Chat folder creation only checks duplicate folder ids within the target
character:

- `server/fastify/src/routes/commands.ts:2669`

Patch and delete endpoints address folders only by `folderId`:

- `server/fastify/src/routes/commands.ts:2697`
- `server/fastify/src/routes/commands.ts:2740`

The resolver returns the first matching folder across all characters:

- `server/fastify/src/commands/chats.ts:286`

Impact: two characters can have folders with the same id, but later update or
delete commands cannot disambiguate them and may operate on the first match.
This weakens the stable-id semantics expected by the client-thinning work.

### P3: Chat module references accept arbitrary ids

`chat.modules` validation only verifies that the field is an array of nonempty
strings:

- `server/fastify/src/commands/chats.ts:443`

Module deletion treats those values as durable module references to clean up:

- `server/fastify/src/commands/modules.ts:168`

Impact: typed chat commands can persist nonexistent module ids. If
`chat.modules` is intended to be a durable reference list, the command path
should validate module existence.

### P3: Closeout docs disagree with current status

The current client-thinning README says EC1 through EC7 are closed:

- `docs/fastify/client-thinning/README.md:64`

But the final audit file still says no exit criterion is resolved and EC1
through EC7 remain open:

- `docs/fastify/client-thinning/final-audit.md:10`

The status file also reports an older full-verification date:

- `docs/fastify/status.md:17`

Impact: the project history is hard to follow and can lead future reviewers to
trust the wrong closeout state.

## Additional lower-confidence edges

- `ROOT_COMPONENT` blocks in `.risu` import can write arbitrary top-level keys.
  If reserved resource-family keys are allowed there, a component block may be
  able to overwrite normalized resource arrays after resource block processing.
- Asset metadata re-upload does not appear to heal a missing blob file when
  metadata already exists. This may be acceptable depending on the intended
  durability model, but it is worth clarifying.
- MCP module boundary behavior is ambiguous: normal module record commands
  reject MCP rows, while some character/module link validation appears to include
  all modules.

## Verification performed

These commands passed on 2026-05-28:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

`pnpm build` passed with existing warnings, including CSS `::highlight`
warnings, browser-externalized module warnings, plugin timing warnings, large
chunk warnings, and ineffective dynamic import warnings.

## Recommended closeout before marking Phase 9 complete

1. Decide whether root create commands truly must require client-supplied ids.
   If yes, remove command-path `randomUUID()` fallbacks and add regression tests
   for every public create endpoint.
2. Extend `pnpm client-thinning:audit` so EC4/EC7 actually check all public
   command-path create helpers, not only child collection helpers.
3. Normalize minimal JSON imports into a fully exportable current-shape database,
   or reject imports that cannot satisfy current export and command invariants.
4. Make chat folder ids globally unique, or include the parent character id in
   patch/delete routes and events.
5. Validate `chat.modules` against existing modules, or document that the field
   intentionally permits unresolved ids.
6. Update stale status and audit docs after the code and tests reflect the final
   decision.
