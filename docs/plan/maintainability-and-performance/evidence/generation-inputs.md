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
warmup/three measured repetitions on the same runtime/hardware. Runtime schema compilation was separately measured and removed through
standalone validators generated from the same schema/options. Native module
import/parsing and first-validation costs remain explicitly measured.

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

## Accepted Work and Timing Evidence

[Final structural counters](generation-costs-after.json) keep the original
fixtures/budgets, plus the separate configuration-row and embedded legacy axes.
Preflight reads five rows, zero messages and zero assets; four-message assembly
reads nine rows. At unrelated sizes 0/12/48, selected snapshots stay 2,715 bytes,
preflight clones stay 2 bytes, effective-state clones 2,069 bytes, and assembly
clones 3,129 bytes. All preparation stages perform zero aggregate database
clones. At 160 target messages, assembly retains 165 necessary read rows and
82,185 clone bytes, within the original 166-row/104,188-byte limits.

[All final paired timing samples](generation-timing-after.json) use three
alternating fresh processes per source, one warmup plus three measured samples
per fixture/process. Medians below pool all nine measured values. Node 24.19.0,
x64, ten logical CPUs and the recorded Ryzen 9950X host match the baseline.
Only one test process ran at a time; no other agent tests/builds ran concurrently.
The baseline checkout is `b3873f52d` with the original probe and installed
workspace dependencies; dependency auto-install was disabled only in that
scratch checkout. Candidate generation source is the standalone-validator
commit plus the already committed selected readers and bounded query programs.
Maintenance handlers under development were not invoked by this probe.

| Fixture | Original baseline preflight / assembly ms | Matched before ms | Final after ms |
| --- | --- | --- | --- |
| 0 unrelated, 4 messages | 0.407 / 2.382 | 0.420 / 2.436 | 0.379 / 2.327 |
| 12 unrelated, 4 messages | 1.066 / 2.812 | 1.678 / 3.376 | 0.315 / 1.825 |
| 48 unrelated, 4 messages | 2.915 / 5.084 | 2.437 / 3.960 | 0.262 / 1.608 |
| 40 target messages | 0.519 / 6.032 | 0.459 / 4.952 | 0.350 / 5.128 |
| 160 target messages | 0.770 / 14.256 | 0.843 / 13.973 | 0.508 / 13.704 |

The final small medians meet the unchanged 0.453/2.409 ms limits; large unrelated
medians meet 1.066/2.812 ms. Required history cost remains, and individual samples
vary: one final small process measured 2.475 ms against its paired baseline
2.500 ms. No sample was removed. [Earlier failed comparisons](generation-timing-investigation.json)
retain the initial regression and intermediate statement-cache measurements.
These are local synthetic preparation times, not production provider latency.

The settings-row residual grows from 886 to 339,610 JSON bytes at 48 unused
Agent/Agent-Preset records; its final pooled preflight/assembly medians are
0.636/1.557 ms. The separately named embedded-character path reads the settings
row twice: 4,222/600,872/2,393,168 total JSON bytes at 0/12/48 unrelated units.
Its captured configuration grows to 553,918 bytes, with final large medians
3.020/4.549 ms. It retains zero aggregate clones and asset rows. This explicit
legacy storage exception does not enter the ordinary selected-read budget.

## Validator Startup and Contract Parity

`generationInputValidators.js` and its finite declaration are generated from the
same checked-in schema by `util/generation-input-schema.ts`. The five roots and
447 definitions remain unchanged. Generated functions preserve Ajv's text with
formatting annotations; no runtime compiler, dynamic evaluation, or runtime
imports are present in that generated module. The decoder imports those checked
functions and exposes only the finite domain boundaries. Runtime schema
compilation is zero; module parsing/evaluation is not claimed to be free.

[Three alternating fresh native-process measurements](generation-validator-import.json)
show median decoder import 541.0 to 97.1 ms and observed post-import heap 60.2 to
9.46 MB. Heap was not forced through GC and is not a retained-memory guarantee.
First settings validation stays similar, 3.69 to 3.56 ms. Every process also
imports Lua and checks valid input identity and invalid domain/path behavior.
The initial runtime-compiled diagnostic was not a controlled improvement ratio;
this later matched comparison replaces it for startup evidence.

## Focused Validation

Each named file ran through `pnpm test -- <one exact file>`:

- `server/fastify/__tests__/generationInputDecoder.test.ts`: 23. Schema, generated
  JavaScript and declarations match the generator; acceptance and complete
  errors match runtime Ajv on all five roots.
- `server/fastify/__tests__/generationInputTypes.test.ts`: 1. Finite fields,
  nested immutability and Lua concrete result channels are compiler enforced.
- `server/fastify/__tests__/generationInputLoaders.test.ts`: 18. Indexed scope,
  precedence, legacy behavior, missing targets, referenced speakers, fresh data
  through reused query programs, and oversized-selector bypass.
- `server/fastify/__tests__/generationPreparationCosts.test.ts`: 4, including all
  twelve dimensions under `RISU_GENERATION_COST_TIMING=1`.
- `server/fastify/__tests__/generation.chat.test.ts`: 181;
  `server/fastify/__tests__/durableGeneration.test.ts`: 69;
  `server/fastify/__tests__/generationOperationsStartup.test.ts`: 1.
- Prompt/consumer checks: assembly 142, Lua 60, lorebook 85, modules 15, templates
  71, dispatch-profile options 100, memory worker 24, display 3, raw translation
  33, completion 96, proxy 32, BardWiki apply 12/rebuild 5.
- Native `server/fastify/browser-smoke/acceptedSendProtocol.spec.ts`: 11. Final
  standalone-module run is recorded in status with the phase gate.

Shared readonly Agent tests and nullable wire correction are separate accepted
commits recorded in status. Prettier, whitespace, current-document and explicit
plan-document checks pass. The final combined aggregate remains the gate after
all implementation phases; user/CI compatibility lanes are separate evidence.

## Compatibility Follow-up from the Combined Load Harness

The unchanged hydration fixture exposed two supported sparse values rejected by
finite decoding: unfiled chats persist `folderId: null`, and command-normalized
plain prompt cards may omit `type2`. The chat command/protocol explicitly accepts
null. Prompt command normalization retains omitted `type2`, and the existing
renderer passes an undefined location to the position parser without treating
it as main/global-note content. The finite contract now preserves both forms;
no default, coercion, clone, fixture repair, or runtime parser change was added.

Regenerated schema/runtime validators have the same compilation policy. Exact
focused checks pass: decoder/drift/Ajv parity 26, strict compiler 1, templates 72,
and the full server load harness 38. The harness now reports early generation
failures directly and checks GC keyset-page bounds plus plugin-only references.
This follow-up closes the observed rejection; final aggregate remains pending.
