# BardWiki Server Type Seam

Status: complete at `44e53527a`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: Phase 3 closeout at `96e0dedfb`; the completed BardWiki behavioral
workstream remains the compatibility oracle.

## Objective

Remove BardWiki's type-only dependency on browser aggregate database and chat
modules by defining the narrow Fastify-owned inputs its server implementation
already consumes.

## Source And Destination

- Sources: `src/ts/storage/database.svelte.ts::Database` and
  `src/ts/process/index.svelte.ts::OpenAIChat` imports in BardWiki server files.
- Destination: a Fastify-owned BardWiki row contract and named generation input
  seam used by canonical model, event model, prompt, apply-turn, and rebuild
  owners.
- Expected delta: eight production type-only root-`src` edges. The two
  model-profile resolver edges remain until Workstream 2 releases that owner.

## Behavior Contract

- Preserve the exact model/profile input supplied to provider dispatch and the
  exact system/user/assistant prompt row shapes.
- Preserve source/document hashes and fences, job transitions, transaction
  boundaries, rollback, final document/version/link/search writes, receipts,
  revisions, and event identity.
- Keep model-profile resolution and provider execution in their current owners.
- Do not move BardWiki application behavior into protocol or shared-core.

## Validation

Add a closed ownership assertion for the BardWiki server family. Run focused
canonical-model, event-model, prompt, apply-turn, rebuild, selection, and
contract fixtures only where the narrowed types affect their compile/runtime
contract. Run both typechecks, the architecture inventory, formatting, and diff
checks.

## Done When

- Every BardWiki production server consumer is free of the two browser
  aggregate/chat type targets.
- The checked inventory accounts for all eight removed edges with no new
  exception or behavior change.
- BardWiki fencing, transactional publication, and provider request parity stay
  proven.
