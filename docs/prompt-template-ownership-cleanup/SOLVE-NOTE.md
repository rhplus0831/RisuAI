# Solve Note

This file is for future agents implementing or revising the prompt template
ownership cleanup plan.

## Manager Instructions

1. Read `README.md`, `status.md`, `plan.md`, and `phases/README.md` before
   choosing a phase.
2. Re-check source symbols before editing. Paths in the plan are anchors, not a
   substitute for reading current code.
3. Keep phases narrow. Do not mix resolver, command, UI, legacy compatibility,
   and final cleanup in one patch unless the user explicitly asks for a large
   integrated change.
4. Prefer owner-aware, row-oriented commands for prompt preset edits. Avoid
   whole-array writes unless a phase explicitly accepts that tradeoff.
5. Preserve legacy bot preset import/export compatibility until a phase
   explicitly retires it.
6. Treat missing prompt-template bodies carefully. In the current projection
   model, missing can mean "not hydrated" rather than "disabled."
7. Run Prettier before committing if implementation work is done.

## Important Current Facts

- `promptPresets` already exist and include `promptTemplate` in their field
  contract.
- Prompt Settings currently edits `DBState.db.promptTemplate`, not a prompt
  preset row directly.
- The prompt-template bridge currently optimizes row-level edits against the
  top-level prompt-template collection.
- Server prompt item commands currently write `prompt_templates`.
- Legacy bot preset apply currently copies preset template data into the active
  top-level prompt template.
- Server and browser prompt assembly currently read the active top-level
  prompt template.
- The Fastify variation is unreleased, so source-level storage reshaping is
  allowed without a formal user-data migration promise.

## Recommended Next Slice

Start with Phase 0. Lock the contract in tests/docs before touching the prompt
template editor or command bridge. The highest-leverage early implementation is
Phase 1: add a shared effective-template resolver with compatibility fallback so
runtime behavior can be covered before editing ownership changes.
