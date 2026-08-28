# Phase 2: Pure Node Promotion

Status: In progress

## Completed Slices

- [Protocol validation](slices/phase-2/protocol-validation.md): promoted three
  protocol-validation suites and 19 tests from Happy-DOM to Node.
- [Test runtime tooling](slices/phase-2/test-runtime-tooling.md): promoted three
  runner/setup contract suites and 18 tests from Happy-DOM to Node.
- [Accessibility source contracts](slices/phase-2/accessibility-source-contracts.md):
  promoted three filesystem-backed source-policy suites and 25 tests from
  Happy-DOM to Node.
- [Client policy and validation helpers](slices/phase-2/client-policy-validation.md):
  promoted five plain TypeScript policy, validation, and data-shaping suites
  and 22 tests from Happy-DOM to Node.
- [Client runtime utilities](slices/phase-2/client-runtime-utilities.md):
  promoted two dependency-injected or explicitly stubbed runtime utility suites
  and seven tests from Happy-DOM to Node.
- [Model provider catalogs](slices/phase-2/model-provider-catalogs.md): promoted
  four discovery, credential-routing, cache, and data-shaping suites and 25
  tests from Happy-DOM to Node.
- [Prompt conversion and tokenization](slices/phase-2/prompt-tokenization.md):
  promoted three prompt conversion, tokenization memo/debounce, and tokenizer
  cache/catalog suites and 16 tests from Happy-DOM to Node.
- [Generation runtime boundaries](slices/phase-2/generation-runtime-boundaries.md):
  promoted three generation capability-registry, inlay-finalization, and raw
  caller source-policy suites and six tests from Happy-DOM to Node.
- [Startup lifecycle state helpers](slices/phase-2/startup-lifecycle-state-helpers.md):
  promoted two dependency-isolated legacy-memory notice and startup telemetry
  state-helper suites and eight tests from Happy-DOM to Node.
- [Storage backup and export helpers](slices/phase-2/storage-backup-export-helpers.md):
  promoted three dependency-isolated backup, dataset-export, and RisuSave
  cache-gate suites and nine tests from Happy-DOM to Node.
- [Hydration reads Node probe](slices/phase-2/hydration-reads-node-probe.md):
  retained the 12-test hydration-read suite in Happy-DOM after its Node probe
  reached a transitive Svelte rune module; a classification probe passed in
  Svelte+Node for later Phase 3 ownership.
- [Alert import safety](slices/phase-2/alert-import-safety.md): corrected the
  import-isolation suite's stale UI-store mock and promoted its one test from
  Happy-DOM to Node without changing production behavior.
- [Character-card PNG import Node probe](slices/phase-2/character-card-png-import-node-probe.md):
  retained the 21-test import/export suite in Happy-DOM after its Node probe
  reached a transitive Svelte rune module; a classification probe passed in
  Svelte+Node for later Phase 3 ownership.
- [Prompt-toggle durability Node probe](slices/phase-2/prompt-toggle-durability-node-probe.md):
  retained the two-test durable mutation suite in Happy-DOM after its Node
  probe reached the outbox activity rune; a classification probe passed in
  Svelte+Node for later Phase 3 ownership.
- [Chat-generation toggle presets Node probe](slices/phase-2/chat-generation-toggle-presets-node-probe.md):
  retained the five-test helper suite in Happy-DOM after Node reached a rune
  and Svelte+Node reached an eager `window` read; later extraction owns any
  smaller-runtime seam.

## Objective

Move existing tests that already prove pure TypeScript behavior out of the
Svelte+Happy-DOM fallback without changing production code.

## Suggested Slice Order

1. Protocol, utilities, parsers, validation, and serialization.
2. Model/provider capability resolution and data shaping.
3. Translation, prompt, and generation helpers with no Svelte runtime.
4. Command planning, projection helpers, and state transitions that are already
   dependency-injected.
5. Remaining unambiguous N candidates discovered by Phase 0.

Keep domain-related files together when they share imports and fixtures. Use
reviewable batches rather than one repository-wide rename/allowlist edit.

## Promotion Rules

- The subject imports no `.svelte` implementation requiring transformation.
- The test does not depend on `document`, `window`, component mounting, focus,
  browser history, DOM events, or implicit Happy-DOM globals.
- Browser-like dependencies such as IndexedDB are explicit subject dependencies,
  not conveniences supplied accidentally by the environment.
- Do not replace a real dependency with a weaker mock solely to make promotion
  pass.
- Type-only imports from Svelte-named modules are allowed only when erased and
  verified in the target project.

## Exit Criteria

- Every Phase 0 unambiguous N candidate is promoted or has a recorded reason to
  remain.
- The legacy Node allowlist is reduced toward the ratified final routing model.
- All migrated tests pass repeatedly in Node and through the root runner.
- File/test counts remain accounted for by the completeness gate.
- Each slice records project and ordinary-frontend timing before and after.
- No slice introduces environment-specific false positives or removes visible
  behavior coverage.
- `../status.md` records remaining N ambiguities and the Phase 2 cumulative delta.

## Validation

- Focused promoted files under `frontend-node`
- Complete `frontend-node` project
- Complete `frontend-dom` project after ownership removal
- `pnpm test:frontend`
- `pnpm test:affected --dry-run`
- Periodic `pnpm test:all` at phase checkpoints
- `pnpm format:check`
- `git diff --check`
