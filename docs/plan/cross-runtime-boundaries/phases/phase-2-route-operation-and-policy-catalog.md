# Phase 2: Route Operation And Policy Catalog

Status: queued.

Depends on: Phase 1 operation identifier and schema conventions.

## Objective

Give route operations stable identifiers and make server policy coverage and
browser operation metadata derive from, or prove exact parity with, one reviewed
catalog.

## Required Work

- Define operation identifiers, methods, path templates, stream classes, cache
  behavior, durability tags, and response classes.
- Derive or structurally verify `server/fastify/src/routeManifest.ts` coverage
  against registered `app.printRoutes()` output.
- Derive or verify the browser durable-command allowlist in
  `src/ts/server/pendingMutationOutbox.ts` by operation identifier.
- Reconcile overlapping route/resource metadata in browser resource manifests,
  cache policy, generation operations, and raw-generation caller gates.
- Keep authentication, active-writer, credential, rate-limit, and host policy
  authoritative on the server.

## Safety Contract

Catalog adoption changes no route, method, mutation, receipt, revision, stream,
cache header, or security decision. A client may know policy metadata but cannot
grant itself authority.

## Exit Criteria

- Every registered API route has reviewed policy coverage.
- Route registration, manifest entries, and durable browser operations cannot
  drift silently.
- Public, observer, active-writer, stream, and compatibility exceptions are
  explicit and tested.

## Validation

Route-protection and manifest tests, durable-outbox allowlist tests, protocol
checks, server tests, browser adapter tests, browser smoke where routing changes,
typechecks, formatting, and diff checks.
