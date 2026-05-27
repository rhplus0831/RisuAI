# Runtime Stages

## Stage 0: Entry Points

Package scripts, launchers, Docker files, and public docs should advertise one runtime path: build the client, start Fastify, and serve the API plus static assets from the Fastify server.

Phase 1 removed:

- Hono build and start scripts.
- Electron and native wrapper scripts.
- Legacy `server.sh` and `server.bat` launchers.
- Capacitor config.

Phase 2 removed:

- `__NODE__` as a Fastify static-serving compatibility bridge.
- The exported `isNodeServer`, `isTauri`, and `isWeb` runtime gates from `src/ts/platform.ts`.

Phase 6 cleanup:

- Public README language now describes the Fastify-served web application.
- README development, production startup, Docker access, and smoke instructions now use the Fastify runtime path.

## Stage 1: Fastify Boot

Fastify constructs the server, mounts `/api/v1/*`, serves static assets, and exposes only the globals or bootstrap payload needed by the Fastify-served client.

Phase 2 cleanup:

- Fastify static serving keeps `globalThis.__FASTIFY__` as the single server-backed signal for the client.

Phase 6 cleanup:

- Smoke startup, Docker access, and local dev instructions now agree on the Fastify port `6002` and retained scripts.

## Stage 2: Client Bootstrap

The client starts from a Fastify-served page and loads server-backed data. It should not fall back to local save-file mode when the Fastify bootstrap path is unavailable.

Cleanup focus:

- Collapse `src/ts/bootstrap.ts` platform branches.
- Remove standalone local initialization.
- Make authentication and storage failures explicit Fastify errors.

Phase 3 cleanup:

- `src/ts/bootstrap.ts` now loads the Fastify bootstrap projection only and reports unavailable or errored bootstrap data explicitly.

Phase 5 cleanup:

- Standalone/PWA storage persistence was removed from `src/ts/bootstrap.ts`.
- `src/ts/storage/persistant.ts` was deleted.
- `public/manifest.json` no longer advertises `display: standalone`.

## Stage 3: Storage And Proxy IO

Client IO should use Fastify route contracts only.

Cleanup focus:

- Keep `/api/v1/storage/*`.
- Keep `/api/v1/proxy/*`.
- Remove legacy storage and proxy endpoints.
- Remove hosted function proxy paths.

Phase 4 cleanup:

- `src/ts/globalApi.svelte.ts` now selects Fastify `/api/v1/proxy/*` routes only for proxy fetch and stream job paths.
- Hosted function proxy files under `public/functions` were deleted.

Phase 5 cleanup:

- `src/ts/storage/backup.ts` now creates Fastify server backups only.
- `src/ts/globalApi.svelte.ts` loads Fastify server backups only and no longer falls back to browser-local internal backup keys.

## Stage 4: Generation Runtime

Generation, sendChat, provider, memory, and command flows should continue to run through the Fastify-backed contracts that the existing migration established.

Cleanup focus:

- Preserve existing sendChat fixture coverage.
- Ensure provider calls do not select local or hosted proxy branches.
- Keep memory and command behavior covered through Fastify route tests.

## Stage 5: Closeout

The closeout stage updates user-facing docs and archives completed phase notes.

Required closeout:

- README and Docker docs describe the same port and startup path.
- Removed platforms are listed in [removed-and-out-of-scope.md](removed-and-out-of-scope.md).
- Phase 7 must record the full verification ladder before moving the final phase file to [phases-completed](phases-completed/).
