# Broad Closeout Alpha - Typecheck Cleanup

Date: 2026-05-27

Status: closed.

## Summary

The broad alpha `pnpm check` blocker is closed. The cleanup kept behavior
changes minimal and fixed the type drift at the affected boundaries:

- Explicitly narrowed result unions with `ok === false` checks where the
  root non-strict `svelte-check` pass did not narrow `!ok`.
- Moved SQLite row casts behind typed memory repository helpers.
- Converted buffered proxy request bodies to DOM-compatible `BodyInit`
  values before `fetch`.
- Narrowed memory job payload, embedding index, and summarize payload
  values before numeric or index use.
- Typed prompt-scope `currentChar` reads and the server-backed/client
  test fixtures without changing runtime behavior.

## Verification

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Results:

- `pnpm check`: passed, 0 errors and 0 warnings.
- `pnpm test`: passed, 69 files, 747 passed, 4 skipped.
- `pnpm api:test`: passed, 68 files, 1217 passed.
- `pnpm build`: passed with existing nonblocking CSS `::highlight`,
  browser-externalized module, dynamic-import/chunk-size, and
  plugin-timing warnings.
- `pnpm smoke:fastify-browser`: passed, 1 browser smoke test.
