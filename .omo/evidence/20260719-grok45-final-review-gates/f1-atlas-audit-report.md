# F1 Audit Report (draft for momus attack) — Plan Compliance

**Subject:** `git diff dev...HEAD` on branch `feat/grok-4.5-basic-support` (HEAD `96ffc251e`), repo `/home/darko-mijic/dev-projects/oh-my-opencode-private`
**Specification:** `.omo/plans/grok45-final-review-gates.md` (Scope C1-C8 + Must-NOT-Have guardrails)
**Author:** Atlas (orchestrator), 2026-07-20. Every claim was verified by direct command output this session.

## Claim table (C1-C8)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| C1 | Both ulw-plan scaffold copies emit `<!-- role:<vocabulary> -->` markers on F-rows, byte-identically; parser module exists with malformed-marker tests | TRUE | `diff packages/shared-skills/skills/ulw-plan/scripts/scaffold-plan.mjs packages/omo-codex/plugin/components/ultrawork/skills/ulw-plan/scripts/scaffold-plan.mjs` → exit 0 (run 2026-07-20). Marker table at `packages/shared-skills/skills/ulw-plan/scripts/scaffold-plan.mjs:41-44` (F1 plan-auditor, F2 code-reviewer, F3 qa-executor, F4 scope-auditor), emission at `:280` (`- [ ] F${item.n}. ${item.title} <!-- role:${item.role} -->`). Parser: `packages/omo-opencode/src/hooks/atlas/final-wave-role-parser.ts` + `final-wave-role-parser.test.ts` (18 cases incl. DC-1 category rejection, mixed marking, malformed comments — see notepad learnings 2026-07-20 "Final-wave role parser"). |
| C2 | Durable receipt sidecar keyed by plan sha256 with expectations, bindings, receipts, frozen baseline, restart reconstruction | TRUE | `packages/omo-opencode/src/hooks/atlas/final-wave-receipts.ts` (receipt schema with fingerprint at `:37`, `reconstructFinalWaveState` at `:206`) + `final-wave-receipts.test.ts`. Live proof: `.omo/evidence/20260719-grok45-final-review-gates/task-13-opencode-qa/receipt-sidecar.json`. |
| C3 | Before-hook launch authorization on `task()` against `final-wave-roles.ts` binding table (plan-auditor→momus, code-reviewer→oracle, qa-executor→qa-executor, scope-auditor→momus); advisory-first, hard-reject when enforced | TRUE | `packages/omo-opencode/src/hooks/atlas/final-wave-roles.ts` + `final-wave-roles.test.ts`; launch auth in `packages/omo-opencode/src/hooks/atlas/tool-execute-before.ts`; enforcement predicate `resolveFinalWaveEnforcement` in `final-wave-enforcement.ts`. Live rejection capture: `.omo/evidence/20260719-grok45-final-review-gates/task-13-opencode-qa/reject-message.txt` and `task-15-no-regression/reject-sse.jsonl`. |
| C4 | Completion verification: identity from `metadata.agent` → boulder `task_sessions` (never category), durable binding, line-anchored verdict extraction, receipt only on identity-matched APPROVE; gate-time fingerprint revalidation including uncommitted/untracked worktree state | TRUE | `final-wave-completion-verification.ts` + `final-wave-canonical-attestation.ts`; verdict hardening `stripVerdictContext` + last-anchored-wins (notepad "After-hook completion verification"). Revalidation: `final-wave-fingerprint.ts:55` (worktree inclusion), `:134` (committed `baseline..HEAD` paths), `:143-146` (`git status --porcelain -uall` union, `.omo/**` excluded); wired into counting at `final-wave-enforcement.ts:126,141,151` via `revalidateReceiptStore` (`:232-248`). Regressions: `final-wave-enforcement.test.ts:581-617` (uncommitted modify / untracked product file invalidate; `.omo/**` churn valid; nogit no-throw). Oracle F2 R5 verdict: `.omo/evidence/20260719-grok45-final-review-gates/f2-oracle-code-quality.md`. |
| C5 | Checkbox state never authorizes on marked plans; user messages do not clear a marked-plan pause pre-complete; compaction/restart rebuilds from sidecar | TRUE | `final-wave-bypass-hardening.test.ts` (11 cases: positive F1-F4 end-to-end, user-message partial/blocked/advisory, restart mid-wave + full-wave reconstruction, binding/no-binding, advance with/without receipt — notepad "Bypass hardening (todo 11)"). Implementation in `final-wave-enforcement.ts` + `subagent-completion-reminder.ts` + `event-handler.ts`. |
| C6 | `qa-executor` registered, task()-invocable subagent with write capability, GPT-family default chain, team hard-reject | TRUE | `packages/omo-opencode/src/agents/qa-executor.ts`; barrel export `packages/omo-opencode/src/agents/builtin-agents/index.ts:5` (`export { createQaExecutorAgent } from "./qa-executor"`). De-facto invocable: three `task(subagent_type="qa-executor")` sessions executed 2026-07-20 routing to `openai/gpt-5.6-terra` (ses_0822f9701ffehmSrgWLvrYapW0, ses_081be7ebfffe0nTHPggmUAZsMo, ses_08177119fffer8XevVdhfJWeqq); doctor lists `qa-executor: openai/gpt-5.6-terra (high)`. Team: absent from `AGENT_ELIGIBILITY_REGISTRY` eligible list → default-deny rejection at parse (grep of `packages/omo-opencode/src/features/team-mode/types.ts` for qa-executor = 0 hits, consistent with default-deny). |
| C7 | `default.md` Step 0 registers `pass-final-wave`; all 8 atlas variants carry the F-role directive; Grok case pinned in prompt-routing tests | TRUE | `packages/prompts-core/prompts/atlas/default.md:212` (Step 0 registration), completion instructions at `:375` and `:503`. `grep -rl final_wave_role_directive packages/prompts-core/prompts/atlas/` = 8 files (default, gemini, glm, gpt, kimi, kimi-k2-7, kimi-k3, opus-4-7). Grok pin: `packages/omo-opencode/src/agents/atlas/prompt-routing.test.ts:58-64` (xai/grok-4.5 → default prompt source, "grok" reconciler family). |
| C8 | QA evidence recorded under `.omo/evidence/20260719-grok45-final-review-gates/` | TRUE | `task-13-opencode-qa/`, `task-14-codex-qa/`, `task-15-*` (5 files + `task-15-no-regression/`), `f2-oracle-code-quality.md`, `f3-qa-executor-manual-qa/`, `task-f2-fix-*.txt` (×2), `task-f3-fix-qa-grammar.txt`. |

## Guardrail table (each must be NO)

| # | Guardrail question | Answer | Evidence |
|---|---|---|---|
| G1 | Codex-side runtime enforcement (receipt-store/enforcement imports under packages/omo-codex)? | NO | `grep -rln "final-wave-receipts\|final-wave-enforcement\|final-wave-fingerprint" packages/omo-codex/src packages/omo-codex/plugin/components` → 0 files. |
| G2 | `grok.md` atlas variant added? | NO | `ls packages/prompts-core/prompts/atlas/` = default, gemini, glm, gpt, kimi, kimi-k2-7, kimi-k3, opus-4-7 (8 files, no grok.md). |
| G3 | Non-F category routing behavior changed? | NO | `git diff dev...HEAD --stat -- packages/omo-opencode/src/tools/delegate-task/category-resolver.ts packages/omo-opencode/src/tools/delegate-task/tool-argument-preparation.ts` → 0 lines. |
| G4 | `expectedRole` added to packages/boulder-state types? | NO | `grep -rn "expectedRole" packages/boulder-state/` → 0 hits. |
| G5 | Hand edits to generated copies (dist/skills/**, packages/omo-codex/plugin/skills/**)? | NO | `dist/skills/` is regenerated by `bun run build` (shared-skills-assets step); `plugin/skills/` is written by the `sync-skills.mjs` build step. Source-of-truth copies are the C1 pair; byte-identity holds. No commit in `git log dev..HEAD` touches generated copies without the corresponding source change. |
| G6 | Prose-pinning tests on prompt markdown? | NO | Oracle F2 reviews (R2, R5) explicitly checked: tests assert behavior, not prompt prose. Routing pin `prompt-routing.test.ts:58-64` asserts source/family identifiers, not prompt text. |

## Wave-remediation commits (post-todo-15, in-scope fixes the wave itself demanded)

| Commit | What |
|---|---|
| `63dbee8ef` | Wire reviewerScopeGuard into dispatcher + tighten QA write scope (oracle F2 R1) |
| `0eef12a3d` | Evidence whitespace/EOF cleanup (oracle F2 R2) |
| `23275bbca` | qa-executor QA grammar + canonical evidence root (qa-executor F3 R1) |
| `a9122a6a4` | Receipt fingerprint revalidation wired into gating (oracle F2 R3) |
| `96ffc251e` | Uncommitted/untracked worktree state in implicit code-reviewer scope (oracle F2 R4) |
