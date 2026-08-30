# Memory-Embedding Configuration Seam

Status: ready.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: BardWiki server type seam at `44e53527a` and the released embedding
operation protocol at `58a847a11`.

## Objective

Remove memory-embedding resolution and job execution's direct type-only imports
of browser model/database declarations by owning the exact server-used model
vocabulary and settings inputs in Fastify.

## Source And Destination

- Sources: browser `HypaModel` and aggregate `Database` imports in
  `memoryEmbeddingModel.ts` and `memoryEmbedJobHandler.ts`.
- Destination: narrow Fastify-owned memory-embedding model, credential, custom
  provider, and Hypa V3 preset/settings input records.
- Expected minimum delta: four production type-only root-`src` edges. The
  same-domain `embeddingOperations.ts` database edge is optional only if its
  contract can be narrowed without affecting command or provider policy.

## Behavior Contract

- Preserve every accepted model literal and provider alias, plus exact rejection
  of browser-local models on the server.
- Preserve custom URL normalization, request model, API-key selection,
  dimensions, input limits, batch limits, and error text.
- Preserve Hypa V3 preset selection/settings normalization, SQLite job
  transitions, batching, deadlines, provider dispatch, masking, and persistence.
- Do not create a shared aggregate database or move browser-local embeddings to
  the server.

## Validation

Add a server-owned vocabulary/ownership assertion. Run focused embedding-model,
embedding-job, and embedding-operation fixtures where the narrowed inputs touch
their contracts, plus both typechecks, architecture inventory, formatting, and
diff checks.

## Done When

- Resolver and job production files no longer import browser `HypaModel` or
  aggregate `Database` declarations.
- The baseline accounts for every removed edge without a new exception.
- Provider requests, bounds, credentials, errors, job state, and persisted
  results remain unchanged.
