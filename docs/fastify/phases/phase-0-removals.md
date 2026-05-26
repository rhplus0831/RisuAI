# Phase 0 - Removals

Date: 2026-05-26

Status: closed 2026-05-20.

Phase 0 removed the legacy surfaces that would have complicated the
Fastify migration: group chat, peer multi-user chat, Risu Account Sync,
Google Drive sync, and the Supa / Hypa V2 / Hanurai memory-engine entry
points. Hypa V3 may still consume legacy field names and shared embedding
helpers.

Original closeout work is complete. A post-closeout audit found a tracked
Google Drive public worker artifact; that follow-up is tracked in
[`phase-0-removals-followup.md`](phase-0-removals-followup.md).
Do not reintroduce removed live surfaces during later phases.

Completed detail: [`../phases-completed/phase-0-removals.md`](../phases-completed/phase-0-removals.md).
