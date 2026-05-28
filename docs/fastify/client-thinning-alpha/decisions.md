# Decisions

Date: 2026-05-28

These are the alpha decisions that task agents should implement unless a bucket
uncovers new evidence. If a decision changes, update this file before or in the
same patch as the implementation.

## AEC1 - Root command ids

**Decision:** Command-path create helpers must require a client-supplied stable
id. They must not mint ids with `randomUUID()` or any equivalent fallback.
Import/bootstrap repair helpers may still mint ids for malformed legacy data.

**Why:** The projection model relies on the browser knowing the id it is
optimistically projecting. Server-side minting in public command paths produces a
different semantic from import repair and makes EC7's structural audit
untrustworthy. A boolean `allowRepair` flag is not enough; the command validator
and import repair helper should be distinct enough that the audit can identify
which side may mint.

**Audit rule:** `pnpm client-thinning:audit` must inspect root create helpers in
`server/fastify/src/commands/*`, not just child-record validators.

**Implementation note:** Bucket 1 closed this by keeping public
`create*Record` helpers strict and moving legacy/default id minting into
separate repair helpers used by import/bootstrap/default-generation paths.

## AEC2 - Import/export current shape

**Decision:** Any import path that accepts a database must persist an
exportable current-shape database. If the server cannot normalize the payload
without inventing unsupported resource families, it should reject the import
before persistence.

**Why:** Import and export are both server-owned durable-state boundaries. It is
not acceptable for JSON import to accept a state that block export immediately
rejects. The existing `.risu` normalizer is the shared repair boundary, but it
must produce every collection shape that export treats as required.

**ROOT_COMPONENT rule:** ROOT_COMPONENT blocks may not overwrite reserved
resource-family keys into arbitrary shapes after resource block normalization.
Reserved families should be ignored from ROOT_COMPONENT, rejected, or routed
through the same family-specific normalizer.

**Implementation note:** Bucket 2 closed AF2 by making the shared import
normalizer always produce the block-export-required families:
`characters`, `botPresets`, `modules`, `loadouts`, and `plugins` as arrays plus
`pluginCustomStorage` as an object. Existing family-specific repair helpers own
any additional defaults they add, such as character ordering or selected preset
indices.

## AEC3 - Asset walker/validator parity

**Decision:** Every field walked by
`server/fastify/src/risuSave/assetReferences.ts` as a server asset reference must
have a write-side validator on every public command path that can mutate it.
`database.botPresets[*].image` is in scope.

**Why:** The export/bundle walker defines which persisted strings the server
treats as durable asset references. If command writes can store unchecked values
there, export becomes the first place users see missing-asset failures.

**Validator semantics:** Optional server asset refs should keep the established
clear values: `undefined`, `null`, `""`, and `"-"` are allowed; malformed asset
ids and valid-looking missing persisted asset ids are rejected.

## AEC4 - Chat folder identity

**Decision:** Preserve the current public patch/delete route shape and promote
chat folder ids to globally unique command-path ids. Creation should reject a
folder id already used by any character. Import/bootstrap repair may rewrite
duplicates if needed to normalize legacy data.

**Why:** Patch and delete currently address only `folderId`, so the route shape
already treats folder ids as global. Enforcing global uniqueness on create is
less disruptive than adding a parent id to existing public routes and events.

## AEC5 - Module reference semantics

**Decision:** Durable command-written module reference lists should validate
against the intended module ownership scope. Normal chat/character module links
should target normal user modules unless a separate MCP-specific command surface
is introduced.

**Why:** Prompt assembly may safely ignore unresolved ids at runtime, but command
persistence should not silently create dangling durable references. MCP modules
have a distinct ownership path; mixing them into normal module links without a
documented rule creates unclear cleanup and edit semantics.

If implementation finds that unresolved module ids are a deliberate compatibility
feature, record that exception here and add explicit tests showing they are
tolerated intentionally.

## AEC6 - Asset persistence and optional clears

**Decision:** Asset metadata and blob storage should converge on re-upload.
When `addAsset` sees existing metadata but the blob file is missing, the upload
should heal the missing file instead of returning metadata-only success.

**Why:** A metadata row without a readable blob is not a usable server-owned
asset. Re-upload is the natural repair path and is safer than leaving GET to
404 after a successful upload response.

**Test decision:** Optional asset-clear values are intentional API behavior and
must be covered by regression tests for the character audio refs.

## AEC7 - Documentation and closeout state

**Decision:** Alpha closeout is not complete until the docs, invariant audit, and
verification ladder agree. Historical docs can remain as history, but they must
not present stale open/closed claims as current truth.

**Why:** The client-thinning workstream exists because local fixes were claimed
complete while broader invariants stayed underspecified. Documentation drift is a
real closeout risk for future task agents.
