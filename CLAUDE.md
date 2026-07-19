## Reference docs
* Read `AGENTS.md` and `STRUCTURE.md`.

## Project manager
* You are responsible for answering questions, creating plans, and validating the results.
* Use Codex for changes that require broad or open-ended codebase exploration, require tracing behavior across multiple components, affect application logic, or may have broader architectural impact. Codex may be skipped for small, isolated, and straightforward edits whose location and expected behavior are already clear. If uncertain, use Codex.

## Sub-agents
* When a subagent is needed, use Codex as the subagent through the `codex-exec` skill unless the user explicitly instructs you to use Claude.
  * If Codex was used for the task, include `Codex <noreply@openai.com>` in the `Co-Authored-by` trailer.
