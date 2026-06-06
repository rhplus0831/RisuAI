# Slice: File Attach Await

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Finding:
L49. Client prompt-context correctness change.

## Scope

Await Hypa text ingestion in the file-attach context builders before running
similarity search, so attached file contents are deterministically available in
the generated `<File>` prompt block.

This slice owns the three file-context builders in `multisend.ts` and the
focused test that currently hides the race with a synchronous mock. It does
not change file picker behavior, extension allow-listing, prompt block format,
embedding model selection, or Hypa memory search semantics.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L49.
- `src/ts/process/files/multisend.ts`: the three `hypa.addText(...)` call
  sites that build attached-file context before `similaritySearch`.
- `src/ts/process/memory/hypamemory.ts`: `addText` async ingestion contract.
- Awaiting precedents:
  `src/ts/process/postGeneration/emotionFallbackEmbedding.ts` and
  `src/ts/process/embedding/addinfo.ts`.
- Focused test:
  `src/ts/process/files/multisend.test.ts`.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) for
  L49 proof registration.

## Target Shape

- Add `await` to all three file-attach builder calls to `hypa.addText(...)`
  before they invoke `similaritySearch`.
- Update the focused mock so `addText` behaves asynchronously enough to prove
  the race. A promise that resolves only after the test observes ordering is
  better than a synchronous stub.
- Add a deterministic regression test for `.txt` attachments proving the
  `<File>` block contains the attached file content after a real async
  `addText`.
- Keep prompt block formatting, file names, search query construction, and
  extension handling output-compatible.
- Register L49 as `DONE` in the v3 gate and flip only the L49 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Attached text content must be indexed before similarity search reads from
  the temporary Hypa store.
- File prompt output remains the same for successful content, except that
  previously missing content is now present.
- Existing synchronous mocks may still pass, but the new proof must fail
  without the `await`.
- PDF/XML attachment behavior is not broadened except where already controlled
  by existing extension flags.

## Done Criteria

- Each of the three file-attach builders awaits `hypa.addText(...)`.
- A deterministic async test proves attached `.txt` content appears in the
  `<File>` block.
- The old synchronous mock no longer masks the race.
- L49 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run src/ts/process/files/multisend.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
