# Phase 5: Browser Local Surface Cleanup

## Goal

Remove browser-local support that implies the app can run without the Fastify server.

## Scope

- Review `public/sw.js` for share/import, image cache, and local-only behavior.
- Review `src/preload.ts` for web versus non-web branches.
- Remove local bootstrap flows that load save files instead of Fastify-backed data.
- Update UI copy or gates that still advertise local-only operation.
- Keep browser features only when they are normal Fastify-served client features.

## Boundaries

- Do not remove static client serving.
- Do not remove browser APIs that are required by the Fastify-served UI.
- Do not leave service worker routes that imply standalone local data ownership.

## Exit Criteria

- The built client requires Fastify-backed startup.
- Service worker and preload code no longer preserve removed platform behavior.
- Smoke coverage exercises the retained browser path through Fastify.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## References

- `public/sw.js:3`
- `src/preload.ts:7`
- `src/ts/bootstrap.ts:137`
