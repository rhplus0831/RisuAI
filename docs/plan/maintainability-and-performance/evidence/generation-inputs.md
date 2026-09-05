# Selected Generation Inputs and Concrete Contracts

Phase 3 / F02 and F09. Baseline source and original numeric budgets are in
[generation-baseline.md](generation-baseline.md); the final implementation
anchors and disposition belong to [status.md](../status.md).

## Input and Ownership Changes

Preflight reads selected configuration and separate character/chat metadata,
without message or Hypa bodies. Assembly reloads selected owners and target
history after accepted-send and retry boundaries. A request-local factory owns
one decoded assembly snapshot and the names of referenced speakers. Ordinary
collection selection uses ID/namespace expression indexes; it preserves order,
extracted-table precedence, duplicate-prompt rejection, default scaffold template
fallback, stable Hypa identity, and inline credential repair.

Effective configuration is a root overlay over deeply readonly selected values.
The character's mutable fields and target working/authoritative chats have
separate ownership. Provider fallback changes its root settings/profile binding.
There are no whole-database clones in the measured preparation paths. Required
target history still scales with the selected transcript. Module child-lore
activation changes a local envelope, preserving borrowed module configuration.

The finite server domain covers settings, provider/memory views, metadata-only
preflight, character, chat, message, lore, regex, and prompt metadata. Known
misspellings and wrong value types fail strict compilation. Runtime decoders
check persisted known fields against a schema generated from those types; they
preserve identity and unknown extension data without coercion, defaults, field
stripping, or deep copies. Error messages include domain/path and omit values.
Sparse supported options and nullable stored message metadata remain valid.

CBS gets an explicit finite adapter with required scalar defaults. Lua full-chat
replacement validates role/data and retains its existing removal of speaker/name
fields. Lua edit-trigger results are checked before entering typed string/prompt
state. Selected speaker names and misses are captured at assembly start, while
an explicitly available working character remains the primary lookup. No
supported script setter introduces a new speaker ID requiring a later SQL read.

## Deliberately Retained Configuration Cost

The global settings document remains one JSON row. Embedded model profiles,
credentials, Agents, and Agent Presets are parsed before selection; this work
scales with the configuration row. Splitting their authoritative persistence is
outside this selected-read change and would require coordinated writers,
imports, repairs, and rollback. Inline credential repair remains at its existing
boundary. This is an explicit residual, not a claim of constant total I/O.

The probe adds a separate settings-row axis with 0/12/48 unused Agents and Agent
Presets. Selected output and clone bytes stay constant while settings JSON bytes
are 886/85,558/339,610. The original unrelated-character/collection/asset axis
and its budgets remain unchanged. Repository/settings ownership retains this
cost; revisit if configuration-row parsing causes the original small/large
preparation budgets to fail, or a supported settings collection moves out of
that row. Legacy embedded-character storage is separately named and tested as a
compatibility path; it is not the ordinary selected path.

## Verification Scope

All probes use disposable SQLite fixtures and synthetic text, with no provider
or production-data calls. Structural counters measure rows and serialized clone
bytes. Isolated timings exclude the instrumentation and use the original one
warmup/three measured repetitions on the same runtime/hardware. A generated
schema incurs a separate once-per-process compilation cost; request timing does
not hide that as request work.

Fixed fixture tests cover prompt order/options, script mutation isolation,
module/persona/Agent selection, memory, provider dispatch, nullable metadata,
durable failures/retries, and accepted-send rereads. A deterministic registered
operation hook changes the selected prompt after acceptance and before assembly;
the provider sees both the new prompt and the accepted user message. Invalid
known settings reject before any accepted message, operation, revision, or
provider work.

The native browser runner exposed two runtime-module loading issues hidden by
the unit transform: a JSON import needed a Node ESM import attribute, and a Lua
schema guard needed to use the existing root Ajv dependency. Both are exercised
by the final accepted-send browser check. A read-only final review also caught
canonical/legacy regex precedence; its focused cases preserve the shared
resolver's existing selection.

Final measurements and exact verification results are recorded below when the
phase gate completes. The final combined aggregate and user/CI compatibility
lanes remain separate from this focused evidence.
