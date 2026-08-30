# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `d798740f7f266ffd6db6298d9b0e4285822f8e95`
- Historical-oracle proof commit: `d78c67a3a`
- Phase 2 predecessor: `6a6d0ac1f`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 3 shared-core foundation and first chat-page normalization leaf;
  no route, payload, persistence, revision, event, authentication,
  active-writer, credential, host, generation, or UI behavior changed.

## Shared-Core And Parity Proof

- `@risuai/shared-core` is private, side-effect-free, independently typechecked,
  and guarded against bare, dynamic, require, and package-escape runtime
  imports.
- `normalizeChatPageIndex` is the sole production implementation. It has no
  imports or side effects and accepts only the raw pointer plus chat count.
- Three browser call sites and one Fastify call site use the explicit
  `./chat-page` subpath; an ownership test prevents either local body from
  returning.
- Test-only copies of the exact pre-extraction browser and Fastify algorithms
  execute beside the shared helper across malformed, fractional, string,
  negative, boundary, oversized, and empty-chat fixtures.
- The architecture inventory remains at 336 direct root-`src` edges: 233
  production, 95 server-test, and 8 browser-smoke; 173 are runtime/mixed. This
  duplicated-helper extraction introduced no new edge.

## Commands And Results

- `pnpm check:shared-core` passed.
- The shared-core import, ownership, and differential suites passed: 3 files and
  17 tests.
- `pnpm exec tsx util/architecture-inventory.ts` passed the 336-edge boundary,
  19-surface/38-probe compatibility, and 9,917-reference/325-group client
  ownership inventories.
- `pnpm test:affected -- --base d798740f7^` passed test topology, 566 frontend
  files with 7,063 tests, 179 server files with 3,655 passing tests and one
  intentional skip, and 18 current compatibility tests covering 16 cells and
  the healthy cluster-10 regression gate.
- The affected runner correctly reported
  `TEST_AFFECTED_STATUS=FINAL_VERIFICATION_REQUIRED` because later test-runner
  and CI commits are included in that historical base range. The portfolio
  closeout still owns the single `pnpm test:all` run.
- Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

The shared-core package boundary and first duplicated leaf are released. Phase
3 continues with chat load-page normalization; server/browser declaration
decoupling and the remaining 336 root-`src` edges remain explicitly open.
