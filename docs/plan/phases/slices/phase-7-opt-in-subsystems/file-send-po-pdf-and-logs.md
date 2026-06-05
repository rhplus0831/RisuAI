# Slice: File Send PO PDF And Logs

Phase: [7](../../phase-7-opt-in-subsystems.md). Findings: M22, L52, L53.
Runtime change.

## Scope

Remove silent `.po` truncation, remove file-send payload/progress
`console.log`s, and keep PDF bytes binary when passing them to pdfjs.

This slice does not own CharX zip import bounds, inlay image writes, or PNG
card import decoding.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M22, L52, and L53.
- `src/ts/process/files/multisend.ts`: `sendPofile`, `sendPDFFile`,
  `sendTxtFile`, `sendXMLFile`, `postChatFile`.
- `src/ts/util.ts`: `BufferToText`, used by text-based file paths.
- Existing adjacent suites:
  `src/ts/process/coldstorage.test.ts`,
  `src/ts/characters.importChat.test.ts`.
- New focused test home: `src/ts/process/files/multisend.test.ts`.

## Target Shape

- Remove the `if (i > 100) break` testing cap from `sendPofile`, or replace it
  only with an explicit user-visible/configured limit. The default behavior
  should process the full file.
- Remove live `console.log` calls from the file-send path, including `.po` line
  indexes, file extensions, text/PDF/XML similarity payloads, and XML parser
  payload logs.
- Change `sendPDFFile` to accept raw bytes (`Uint8Array` or `ArrayBuffer`) and
  pass those bytes to `pdfjsLib.getDocument({ data })`.
- Keep text-based `.po`, `.txt`, and `.xml` paths using `BufferToText` where
  they need decoded text; do not decode PDF bytes to UTF-8.
- Preserve returned `postChatFile` result shapes and download names.
- Add tests for a `.po` fixture longer than 100 lines, no console logs for
  `.po`/PDF/XML/text cases, and a PDF path stub proving pdfjs receives raw
  bytes matching the selected file.
- Register M22, L52, and L53 as `DONE` in the v2 gate with focused tests, and
  flip all three rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- `.po` translation output for the first 100 lines stays unchanged; later lines
  are now included instead of silently dropped.
- Text and XML similarity behavior remains unchanged except for removed logs.
- PDF extraction still returns a base64 `<File>` block with the same result
  shape.
- No file-send path writes user file contents or derived payload text to
  `console.log`.

## Done Criteria

- A `.po` file with more than 100 lines translates fully.
- PDF file-send passes raw binary data to pdfjs.
- File-send focused tests prove the targeted logs are gone.
- M22, L52, and L53 v2 gate entries point at real focused tests and the
  risk-map rows are `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/process/files/multisend.test.ts src/ts/process/coldstorage.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
