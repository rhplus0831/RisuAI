# Phase 9-6d - Residual Local Cache Classification

Date: 2026-05-26

## Summary

- Fastify-mode RISUSAVE block encode/decode no longer writes or reads the
  browser `risuSaveCache` localForage cache; remote/cache-only blocks now
  report unavailable behavior instead of falling through to local storage.
- Cold-storage helper entry points now return before OPFS, localForage-backed
  NodeStorage, or legacy local-mode paths in server-backed web mode. Chat hydration
  through cold-storage pointers is explicitly unsupported in Fastify mode.
- Google Search MCP credential storage is explicitly unsupported in
  server-backed web mode before local credential localForage reads or writes.
- Runtime-local caches remain intentionally browser-local: MCP tool-call
  display cache, translation/model caches, embedding caches, inlay assets, and
  plugin permission prompts. They are not authoritative server database state.

## Verification

- `pnpm test src/ts/storage/risuSave.test.ts src/ts/process/coldstorage.test.ts src/ts/process/mcp/googlesearchclient.test.ts`
  - passed; 4 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-6e provider secret masking.
- Keep server `.risu` codec/import/export, asset bundle walking, and
  server-owned Google Search credential design deferred to later slices.
