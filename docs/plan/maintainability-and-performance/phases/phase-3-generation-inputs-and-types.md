# Phase 3: Generation Inputs and Types

Findings: F02 and F09. Dependency: Phase 2 accepted and Phase 1 generation/type
baselines available. Progress belongs in [status.md](../status.md).

## Objective and Owners

Give preflight and assembly explicit domain inputs, reducing unrelated loading
and cloning while making required fields compiler-checkable.

Read [prompt assembly and scripting](../../../structure/prompt-assembly-and-scripting.md),
[providers/models](../../../structure/providers-and-models.md), and
[durable generation](../../../../src/docs/generation-client.md). Source owners:

- `server/fastify/src/repository.ts`: `loadPersistedForAssembly` and scoped loaders.
- `server/fastify/src/routes/generationChat.ts` and
  `server/fastify/src/routes/generationOperations.ts`: preflight, accepted-send,
  actual assembly, retries, and revision/lineage boundaries.
- `server/fastify/src/prompt/effectiveGenerationConfig.ts`,
  `server/fastify/src/prompt/assemble.ts`, and
  `server/fastify/src/prompt/serverTypes.ts`.

## Slices

### 3a: Inventory and Explicit Views

Map live `FastifyDatabase` consumers and accessed fields: readiness, settings,
profiles/credentials, selected persona/presets, active modules, target character/
chat, history, memory, agents, and script callbacks. Distinguish preflight needs
from execution and post-generation needs.

Define typed views at the actual boundaries. Known fields have concrete types;
preserved extension fields use `unknown` with local validation. Do not replace
the current alias with another `any`, a blanket cast, or an unchecked generic
accessor. Required legacy spellings and imported extensions must remain usable.

### 3b: Narrow Preflight and Assembly Reads

Preflight should read only readiness/configuration data it needs. Ordinary
assembly should load the selected owners and required history/assets without
parsing unrelated library payloads. Reuse existing scoped SQL, selected-owner
resolution, request-local memoization, and asset lookup before adding a new cache.

Some supported CBS/Lua/trigger APIs inspect broader state or mutate working
history. Preserve those semantics through explicit lazy capabilities or an
audited compatibility snapshot with a named trigger and measured cost. Do not
assume that replacing sibling characters with empty shells is behavior-neutral.

### 3c: Snapshot Ownership and Revision Fences

Build immutable resolved configuration plus a separately owned mutable working
chat/script state. Clone only the data whose mutation/isolation requires it.
Replace the `structuredClone(input.database)` in
`buildEffectiveGenerationConfig` with that explicit ownership model; changing
the repository loader alone does not close the cloning finding.
Preserve initial/authoritative/working-history distinctions used by durable
effects and rollback.

Reuse preflight results only if their lineage, revision, selected owners, and
request overrides still match. An accepted send itself changes the transcript
and revision; a later job, retry, or edit may change them again. Invalidate or
rebuild the affected input after those boundaries. A shared stale snapshot is
not an acceptable way to remove the second load.

### 3d: Consumer Cutover and Type Closure

Migrate consumers in bounded groups and eliminate the unrestricted
`FastifyDatabase = any` production entry contract. Remove unrestricted index
signatures from the participating `FastifyChat`, `FastifyMessage`,
`FastifyCharacter`, `FastifyLoreBook`, `FastifyCustomScript`, and
`FastifyMessagePresetInfo` views, and type `generationSettings` explicitly. A
typed outer alias pointing at those old `any` fields does not close F09.
Any retained dynamic adapter must declare its inputs, validation, owner, and
scope; record remaining unchecked
consumers as unresolved F09 work rather than marking the finding fixed.

## Acceptance

- With a fixed target chat and selected configuration, ordinary preflight and
  assembly read/clone work no longer grows with unrelated character/chat bodies,
  unused collection bodies, or unrelated asset metadata. Explicit dynamic-script
  exceptions are measured separately and cannot become the default path.
- Known prompt input field mistakes fail strict compilation; schema/legacy
  extension validation occurs at a named boundary. No new unchecked aggregate
  alias or broad type suppression replaces the old one.
- Fixed request fixtures preserve prompt ordering/bytes, selected credentials,
  provider/body options, agent/module/persona behavior, token/memory budgeting,
  and scripted effects. Stale preflight, failed acceptance, retry, and concurrent
  background completion preserve the existing durable behavior.
- Counts/bytes and isolated timings improve against Phase 1 without increased
  unbounded retained memory or a slower representative small configuration.

## Verification and Rollback

Existing owners include `server/fastify/__tests__/assemble.test.ts`,
`server/fastify/__tests__/generationOperations.test.ts`,
`server/fastify/__tests__/generationOperationsStartup.test.ts`, and
`server/fastify/browser-smoke/acceptedSendProtocol.spec.ts`. Select additional
effective-settings, scripting, and memory cases from
[prompting tests](../../../tests/prompting-generation-and-streaming.md) and
[scripting tests](../../../tests/scripting-parsing-and-automation.md).

Use exact focused tests plus cost probes, `pnpm check:server`, and the final
`pnpm test:agent` workflow. Record relevant user/CI compatibility evidence; do
not silently regenerate compatibility goldens or claim local tests replace the
pinned differential. Update current guides after each owner cutover.

Keep old behavior available until each typed/scoped consumer passes parity,
then remove the replaced path. Revert a bounded consumer cutover if parity fails;
do not change persisted formats or credential semantics to make it pass.
