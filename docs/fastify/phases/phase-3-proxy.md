# Phase 3 - Proxy Migration

Date: 2026-05-24

Status: closed 2026-05-21.

Phase 3 moved the proxy, hub passthrough, stream-job WebSocket, storage,
auth, and crypto surfaces onto Fastify, then deleted the Express server
and its `runserver` script.

Current work: none in Phase 3. The known follow-up is hub-route session
auth for browser-loaded hub resources that cannot send `risu-auth`
headers; that is tracked in [`../status/next-steps.md`](../status/next-steps.md).

Completed detail: [`../phases-completed/phase-3-proxy.md`](../phases-completed/phase-3-proxy.md).
