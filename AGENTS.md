## Environment Notes

- This is an Ubuntu environment, and you can use the following commands. Use them if necessary:
  - rg, fdfind, fzf, batcat, eza, zoxide, jq, yq, delta, gh, just, entr, shellcheck, shfmt, hyperfine, strace, lsof, btop
- use pnpm

## Response Language Guideline

Write all responses in English, regardless of the language used in the user's input.

## Collaboration Guideline

When writing commit title, use prefixes like feat:, fix:, and refactor:

## Fastify Migration Docs

Use `docs/fastify-followup-alpha/status.md` and `docs/fastify-followup-alpha/status/next-steps.md`
as the live handoff for current work. Use `docs/fastify-followup-alpha/phases/` only
for active or remaining phase scope, boundaries, and exit criteria.
Completed slice logs and historical detail belong in
`docs/fastify-followup-alpha/phases-completed/`; do not turn the active phase/status
docs back into long work logs.

There are no actual Fastify users yet, so do not write compatibility
migrations during this process. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.
