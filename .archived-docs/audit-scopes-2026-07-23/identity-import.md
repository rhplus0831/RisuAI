# Audit scope: Identity & import normalization

Status: DRAFT 2026-07-23. Freshly remediated (the three most recent commits);
open items are deliberately deferred and symptom-gated.

## Charter

**In scope:** entity identity (lorebook entry IDs, chat IDs, script/trigger
IDs) at every creation and import boundary — `.risu`/`.charx`/realm import,
character/module/chat creation, MCP-driven creation — and the fidelity of
imported payloads (nothing silently dropped or replaced).

**Out of scope:** payload durability once identities are correct (see
[data-durability.md](data-durability.md)).

Key code: `src/ts/server/lorebookBridge.svelte.ts`
(`normalizeClientLorebookEntryIds`, identity-dirty scopes),
`src/ts/characters.ts` / `characterCommands.ts` (import normalization),
server create-path repair (`repairCreatedLorebookEntries`).

## Issue history

Landed 2026-07-23 (`d89b0c6d4`, `c80c75126`, `88066c2a8`): imported bots'
lorebook toggles failed with server 404 because imports seeded **ID-less**
server rows while the client minted v4 IDs locally and dispatched
ID-addressed sparse writes. Root insight: per-item ID-addressed commands only
work when client and server agree on IDs, and the server can never guess
client-minted ones.

Two silent-loss bugs found in the same batch: `.charx` import always passed a
truthy `[]` override lorebook, discarding the card's own `character_book`;
and an ID-less imported "Chat 1" was silently dropped by character-create.

**Pattern for this scope:** identity minted too late (after rows exist on the
other side of the protocol), and import paths that silently substitute or
drop payload sections instead of failing loudly.

## Open items (all deliberately deferred — act on symptoms only)

- `ACCEPTED` — module receipt-certification hardening.
- `ACCEPTED` — create-path rejection of ID-less nested collections (repair
  was chosen instead of rejection).
- `ACCEPTED` — export-format ID preservation beyond `.risu` (which already
  preserves IDs).

## Invariants for new code

- **IDs are born at creation/import boundaries.** Any new path that creates
  characters/chats/modules must give nested entries stable unique IDs
  *before* dispatching: client boundary helper
  `normalizeClientLorebookEntryIds` (mints missing AND duplicate IDs); server
  create-paths use `repairCreatedLorebookEntries` (warns when it minted).
- While a lorebook scope is identity-dirty, the bridge forces
  `{kind:'replace'}` — ALL delta plans suppressed; the flag clears only on
  accepted generation-matched replace or canonical projection apply. **Never
  add a per-entry command path that bypasses the dirty check.**
- Do not "simplify" `ensureClientLorebookEntryIds` back to missing-only —
  dedupe matters because `.risu` export preserves IDs and re-import into the
  same scope would collide.

## Sources

Memory: `lorebook-identity-dirty-scope`. Commits: `d89b0c6d4`, `c80c75126`,
`88066c2a8` (messages document the boundary contract).
