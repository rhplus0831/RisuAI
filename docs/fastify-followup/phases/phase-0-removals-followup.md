# Phase 0 Follow-Up - Removals

Date: 2026-05-26

Status: closed again by Slice 0A.

## Goal

Finish the Phase 0 removal contract for Google Drive sync artifacts.

## Audit Finding

Google Drive OAuth exchange code remains in a tracked public asset:
`public/functions/drive.js:25` posts the OAuth `code`, `CLIENT_ID`, and
`CLIENT_SECRET`. Because the file lives under `public/`, Vite can copy
it into built assets even though Google Drive sync is listed as removed.

## Tasks

- [x] Delete `public/functions/drive.js` and any build or deployment
  references that keep it reachable.
- [x] Search for remaining Google Drive sync entry points and remove only
  live code paths. Static language strings or historical docs can remain
  if they are not shipped as an active feature.
- [x] Add or update a focused test or build assertion if the project already
  has a public-asset inventory guard. No existing public-asset inventory
  guard was found, so Slice 0A used the focused `rg` audit plus `pnpm build`.

## Session Slices

- 0A - Google Drive public artifact removal. Delete the public function
  file, remove only live build/deploy references that keep it reachable,
  rerun the focused search, and run the build. This is intentionally a
  single cleanup session. Landed 2026-05-27; see
  `../phases-completed/phase-0-google-drive-public-artifact-removal-2026-05-27.md`.

## Exit Criteria

- No tracked public asset exposes the Google Drive OAuth exchange route.
- Fastify web build no longer includes a Google Drive sync worker or
  function file.
- The original Phase 0 removal claim remains true without relying on
  dead UI hiding.

## Verification

```bash
rg -n "functions/drive|/drive(?:\\.|$)|drive\\.js|CLIENT_SECRET|CLIENT_ID|Google Drive sync|savebackup|loadbackup" public src server --glob '!public/token/**' --glob '!src/lang/**'
rg -n "CLIENT_SECRET|CLIENT_ID|functions/drive|drive\\.js" dist public src server --glob '!public/token/**'
pnpm build
```

## References

- Original phase: `docs/fastify/phases/phase-0-removals.md`
- Source finding: `public/functions/drive.js:25`
