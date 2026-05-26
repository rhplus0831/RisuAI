# Phase 0 Follow-Up - Removals

Date: 2026-05-26

Status: reopened by audit.

## Goal

Finish the Phase 0 removal contract for Google Drive sync artifacts.

## Audit Finding

Google Drive OAuth exchange code remains in a tracked public asset:
`public/functions/drive.js:25` posts the OAuth `code`, `CLIENT_ID`, and
`CLIENT_SECRET`. Because the file lives under `public/`, Vite can copy
it into built assets even though Google Drive sync is listed as removed.

## Tasks

- Delete `public/functions/drive.js` and any build or deployment
  references that keep it reachable.
- Search for remaining Google Drive sync entry points and remove only
  live code paths. Static language strings or historical docs can remain
  if they are not shipped as an active feature.
- Add or update a focused test or build assertion if the project already
  has a public-asset inventory guard.

## Exit Criteria

- No tracked public asset exposes the Google Drive OAuth exchange route.
- Fastify web build no longer includes a Google Drive sync worker or
  function file.
- The original Phase 0 removal claim remains true without relying on
  dead UI hiding.

## Verification

```bash
rg -n "CLIENT_SECRET|CLIENT_ID|drive\\.js|Google Drive sync" public src server docs/fastify-followup
pnpm build
```

## References

- Original phase: `docs/fastify/phases/phase-0-removals.md`
- Source finding: `public/functions/drive.js:25`
