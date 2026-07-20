# Issues - grok45-final-review-gates

Track blockers and deviations here.

## 2026-07-20T — F2 code-quality rejection fix

- Wired `hooks.reviewerScopeGuard?.["tool.execute.before"]` into `packages/omo-opencode/src/plugin/tool-execute-before.ts` next to the other write/Bash guards (it was created in `create-tool-guard-hooks` but never dispatched).
- Tightened `isQaWritablePath()` so qa-executor writes are limited to `.omo/evidence/**`, worktree `evidence/**`, and OS temp — not arbitrary product paths under the session worktree.
- Added dispatcher coverage in `tool-execute-before-reviewer-scope-guard.test.ts` proving momus/oracle writes and unsafe Bash are rejected, while qa-executor evidence writes are allowed.
- Fixed `git diff --check` failures: trailing blank lines at EOF in `packages/prompts-core/prompts/atlas/*.md`, and trailing whitespace in `.omo/evidence/20260719-grok45-final-review-gates/**`.

## 2026-07-20 — Momus structurally cannot run execution-fidelity audits (F1/F4 blocked)

- 8 launch attempts across fresh sessions, continuations, and 3 framings (direct audit, corrective redirect, adversarial "attack this audit report" inversion). Every response was the plan-critic SOP: `[OKAY]` non-verdicts (6x) or SOP-shaped `[REJECT]`s (2x).
- F4 attempt revealed the hard input contract: `[REJECT] Invalid input: no single .omo/plans/*.md path was provided` — the momus agent requires a single plan-file input and only reviews plan quality/executability.
- F1 inversion attempt reviewed the PLAN (not the audit report it was told to attack) and rejected it for "F1-F4 rows lack executable QA scenarios" — confirming the SOP cannot be redirected by prompt content.
- Model: openai/gpt-5.6-terra-fast, responses in 6-90s, never opened the diff.
- Product finding (follow-up candidate): momus prompt needs an execution-fidelity audit mode, or F1/F4 bindings need a reviewer whose SOP covers committed-diff audits.
- Blocked sessions: F1 ses_08157794cffewiTnmW1b3kpL3q / ses_0814cfa4bffeENM54I4qiUVXac; F4 ses_08176bf3cffexZ0yco8MPaEA5x / ses_0814cb4a6ffekMyAsuPHd5o8tT.

## 2026-07-20 — F3 blocked on process-held stale dist

- This OpenCode process loaded dist/index.js at ~08:27; the fixed reviewer-scope-guard grammar landed in dist at ~10:00. The qa-executor's own Bash is policed by the OLD in-memory guard (mkdir/git worktree/bun run denied), so the F3 live QA workflow is impossible inside this process regardless of rebuilds. Requires user restart of OpenCode; session/boulder/plan state survive in DB.
