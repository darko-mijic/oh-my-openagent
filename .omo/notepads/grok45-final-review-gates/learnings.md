# Learnings - grok45-final-review-gates

Session artifacts live here.

## 2026-07-20 Final-wave role parser

- Added the pure, fence-aware final-wave role parser; its focused Bun suite passed all 18 cases, including DC-1 category rejection, mixed marking, malformed comments, and scoped markers.

## 2026-07-20 QA executor and reviewer scope guard

- Registered `qa-executor` as a GPT-first final-wave subagent and added a session-aware Tool Guard policy: Momus and Oracle are read-only, while QA writes stay inside evidence, temp, or its session worktree and QA Bash accepts only tokenized test and Git inspection commands.

## 2026-07-20 Final-wave role-marker scaffold

- Both hand-maintained `ulw-plan` scaffold sources now emit fixed F1-F4 `<!-- role:... -->` markers. The role table is pinned by the Codex scaffold suite together with a source byte-identity check; OpenCode and Codex workflow references document their respective reviewer bindings without changing the dual-review drift contract.

## 2026-07-20 Final-wave fixture harness

- Added reusable polarity plan, completion, and receipt-sidecar fixtures. The existing gate regressions now use the locked marker mapping while retaining their annotation-blind checkbox/verdict assertions.

## 2026-07-20 Scope-intersection receipt fingerprints

- Added DC-2 fingerprints with a frozen baseline diff for code review, deterministic scoped content hashes, and non-Git fallback. Receipts now remain valid across out-of-scope remediation and invalidate only when their effective scope changes.

## 2026-07-20 Role-aware plan-state validation

- Atlas tracking now retains final-wave section and optional reviewer expectations, shares parser-derived role diagnostics with the warn-only plan validator, ignores fenced F-row decoys in pending counts, and emits a repeated UNVERIFIED marker for legacy final-wave completions.

## 2026-07-20 Durable final-wave receipt store

- Added an atomic execution-wave receipt sidecar with frozen role-row contracts, pre-spawn expectations, launch-to-child bindings, rejected-completion outcomes, restart reconstruction, and marked-plan corrupt-sidecar quarantine. It is intentionally unwired from runtime enforcement until the later gate todos consume it.

## 2026-07-20 Before-hook advisory launch authorization

- Marked F-row `task()` launches now resolve the bound named subagent via `FINAL_WAVE_ROLE_SUBAGENT_BINDINGS`, classify category/wrong/absent routes as advisory mismatches (never blocked), mint a fresh `launchId`, persist the receipt expectation before return, and stamp `expectedRole`/`expectedSubagent`/`launchId` onto the pending track ref for the after-hook. Non-echoing prompts and legacy-unmarked plans write no expectation (fail-safe / zero behavior change).

## 2026-07-20 Prompt alignment (todo 12)

- Restored umbrella `pass-final-wave` registration in `atlas/default.md` Step 0 alongside granular substep tracking; kept Step 4 and boulder-complete completion instructions so compaction-todo-preserver re-injection stays coherent.
- Appended an identical `<final_wave_role_directive>` block to all 8 atlas variants: named-subagent F-row launches, no categories, mandatory `F<n>. <title>` TASK echo, task-shaped reviewer prompts ending in line-anchored `VERDICT: APPROVE|REJECT`.
- Scoped Grok overlay category preference to implementation waves only; F-rows require plan-declared named subagents plus the echo rule.
- Pinned routing behavior: `xai/grok-4.5` → prompt source `default` + reconciler family `"grok"` (no new `grok.md`).
- Verified: `bun test packages/omo-opencode/src/agents/atlas/prompt-routing.test.ts` (13 pass), `bun test packages/prompts-core` (26 pass), `bun run build` ok, `bun run typecheck` clean; bundled `dist/index.js` contains the F-role directive and updated overlay text.

## 2026-07-20 After-hook completion verification (todo 9)

- Hardened `classifyFinalWaveVerdict` via `stripVerdictContext` (drop fenced blocks + blockquote lines) and line-anchored `/^VERDICT:\s*(APPROVE|REJECT)\b/i` with last-anchored-wins semantics. Mid-line decoys such as `I would not VERDICT: APPROVE` no longer match.
- Added `final-wave-completion-verification.ts` + `final-wave-canonical-attestation.ts`: identity prefers `metadata.agent` then boulder `task_sessions[taskKey].agent`; durable binding required (pending launchId or sidecar childSessionId lookup); never falls back to `readCurrentTopLevelTask` for receipts.
- Binding persisted on both launch paths: sync after-hook captures pending ref before delete; background path `syncBackgroundLaunchSessionTracking` records binding when launchId is present.
- Receipt written only on anchored APPROVE + identity match + live binding + clean canonical-tree attestation (`.omo/**` excluded except plan). Advisory mode logs/appends reminder text and never changes gate outcome.
- Verified: `bun test packages/omo-opencode/src/hooks/atlas/final-wave-approval-gate.test.ts` (22 pass), full atlas suite 278 pass, `bun run typecheck` clean.

## 2026-07-20 Fail-closed flip (todo 10)

- Added `resolveFinalWaveEnforcement(planPath, workspaceRoot?)` → `enforced | advisory | blocked`.
  - Enforced only when parser status is `marked`, sidecar is verifiable (missing = empty-valid), and effective `gitHead !== "nogit"`.
  - Blocked on marked+git when sidecar is corrupt (auto-quarantine to `*.receipts.corrupt-<ts>.json`) or frozen `fRowContract` is violated.
  - Advisory for legacy-unmarked, mixed/invalid, non-git (including corrupt there), and non-marked plans.
- Gate: enforced mode counts only durable receipts (`approvedCount >= requiredCount`); checkbox state and bare `VERDICT` text no longer advance. Advisory keeps prior checkbox/verdict counters.
- Launch auth: enforced mismatches hard-reject (`throw` after rejection message) with no expectation persistence and no pending-task track. Advisory mismatches still warn + persist.
- Completion reminder: under enforcement, F-row `isAlreadyVerified` requires a receipt for that row; blocked mode surfaces loud escalation and keeps the pause.
- Receipt write now runs before the pause decision so the completing reviewer's receipt is counted in the same turn.
- Verified: atlas suite 296 pass, root `bun test` 11991 pass / 0 fail, `bun run typecheck` clean.

## 2026-07-20 Bypass hardening (todo 11)

- Advance path: `buildAdvanceDirective` is double-gated under enforcement — `resolveIsAlreadyVerified` + `canAdvanceAfterVerified` both require `hasFinalWaveReceiptForRow` for the current F-row. Checkbox-only "already verified" never advances.
- User message: `message.updated` no longer blindly clears `waitingForFinalWaveApproval`. Enforced plans clear only when every required receipt exists; blocked plans never clear; advisory/legacy keep the old clear-on-user-message behavior.
- Compaction/restart: `session.compacted` still drops the in-memory map. `reconstructFinalWavePauseState` rebuilds counters + pause from the receipt sidecar on idle, idle-retry, and subagent-completion. Pause = all receipts present (or blocked); mid-wave does not pause so remaining F-rows can still launch.
- Binding after restart: completions match durable `bindings` by `childSessionId`; no binding → `missing-binding`, never `readCurrentTopLevelTask`.
- Gate state is owned by the receipt sidecar; `compaction-todo-preserver` still owns todo LIST state (`pass-final-wave` bootstrap) independently.
- Tests: `final-wave-bypass-hardening.test.ts` (11 cases) — positive F1-F4 end-to-end, user-message partial/blocked/advisory, restart mid-wave + full-wave reconstruction, binding/no-binding after restart, advance with/without receipt.
- Verified: atlas suite 307 pass, `bun run typecheck` clean; root `bun test` 12001 pass / 1 flake timeout in `prompt-async-route-audit.test.ts` (passes alone at 7.4s; pre-existing 5s budget under full suite load).

## 2026-07-20 Codex QA (todo 14)

- Ran codex-qa isolation discipline + `bun run test:codex` (512 pass / 0 fail). Dual-review drift pin `ulw-plan-review-state-contract` + `scaffold-plan` suite: 24 pass.
- Isolated `CODEX_HOME` install via `node packages/omo-codex/scripts/install-local.mjs install` landed `omo@sisyphuslabs` at plugin cache `4.19.0`. Installed `scaffold-plan.mjs` is byte-identical to `packages/shared-skills` and `plugin/skills` copies.
- Scaffold under isolated workspace emitted F1-F4 `<!-- role:plan-auditor|code-reviewer|qa-executor|scope-auditor -->` rows; installed `full-workflow.md` carries Codex prompt-level reviewer bindings (`lazycodex-gate-reviewer` / `lazycodex-code-reviewer` / `lazycodex-qa-executor`) with no runtime enforcement (DC-4a).
- First-party app-server drive `--plugin`: `ok:true`, hooks `sessionStart` + `userPromptSubmit` + `stop` completed, `missingHooks: []`. hook-unit-probe ultrawork self-test passed. install-verify passed on solo retry after a concurrent sync-skills race flake.
- Real `~/.codex/config.toml` sha256 unchanged before/after: `c60942c49949d55b521cb72d33a573767459cdc20b4751679086c9fb21b4a5c4`. Evidence: `.omo/evidence/20260719-grok45-final-review-gates/task-14-codex-qa/`.
- Post-QA: `bun run typecheck` exit 0. Full `bun test` 12001 pass / 1 fail — same pre-existing `prompt-async-route-audit.test.ts` 5s timeout flake under suite load; alone pass.
- Flake detail: `prompt-async-route-audit.test.ts` needs ~5.9s; default 5s budget fails even alone; `bun test --timeout 30000` on that file: 10 pass / 0 fail.

## 2026-07-20 OpenCode real-harness QA (todo 13)

- Isolated XDG + fake OpenAI Responses server + local `file://$REPO` plugin proved all four Todo 13 gates on OpenCode 1.18.3.
- Marked+git F2 `task(category=unspecified-high)` hard-rejects at `tool.execute.before` with `<final-wave-named-reviewer-rejection>` on SSE `message.part.updated` and `opencode run --format json` tool_use error.
- Correct F2 `task(subagent_type=oracle)` + child `VERDICT: APPROVE` writes durable `.receipts.json` (expectation + binding + receipt). Requires parent session id in boulder `session_ids` so lineage validation can bind the child.
- Legacy-unmarked F2 category route is not rejected (old behavior).
- Host `opencode.db` session count unchanged (97→97). Evidence: `.omo/evidence/20260719-grok45-final-review-gates/task-13-opencode-qa/`.
- Pitfall: `oqa_wait_http` can hang while the plugin loads (TCP accept before health responds) — use curl `--max-time` polls. Empty boulder `session_ids` yields missing-binding and no receipt even when the child APPROVEs.

## 2026-07-20 No-regression Grok category + repo gates (todo 15)

- Isolated OpenCode sandbox (XDG + fake OpenAI/xAI Responses + file:// plugin) proved NON-F `task(category=unspecified-high)` resolves `metadata.agent` → Sisyphus-Junior / sisyphus-junior and model `xai/grok-4.5` (variant high) under Grok-pinned config.
- Same sandbox polarity: marked F2 category route hard-rejects with `<final-wave-named-reviewer-rejection>` (requires oracle). Host DB session count 98→98.
- Repo gates all exit 0: `bun test` 12002 pass / 0 fail; `bun run typecheck` clean; `bun run build` ok; `dist/skills/ulw-plan/scripts/scaffold-plan.mjs` emits F1–F4 `<!-- role:... -->` markers and full-workflow reviewer bindings (momus/oracle/qa-executor/momus).
- Host `omo-local-plugin.sh refresh` then `verify` both exit 0; dogfood wiring points at local file:// checkout; sisyphus-junior + unspecified-high still xai/grok-4.5. Running OpenCode PIDs warned (restart needed for live reload) — disk check only.
- Evidence: `.omo/evidence/20260719-grok45-final-review-gates/task-15-grok45-final-review-gates.txt` + `task-15-no-regression/`.
- Pitfall: without sandbox `auth.json` marking xai connected, category resolution falls back off xai/grok-4.5 even when agent config shows it; synthetic api-key auth + xai provider baseURL override fixed runtime metadata.model.

## 2026-07-20 F2 whitespace fix (evidence)

- Cleared `git diff --check dev...HEAD` failures that caused F2 code-quality REJECT: trimmed trailing whitespace and removed blank lines at EOF in 12 committed evidence files under `.omo/evidence/20260718-grok45-baseline/`, `20260718-prometheus-grok-gaps/`, `20260718-prometheus-grok-reasoning-effort/`, and `20260719-grok45-final-review-gates/task-{13,15}-*/` (JSONL kept single trailing newline after last record). Content bytes otherwise unchanged.

## 2026-07-20 F3 qa-executor grammar fix

- Split the qa-executor policy from the unchanged Momus/Oracle grammar: exact `&&` tokenization validates every segment, explicit environment assignments and QA command families are allowlisted, and eval/redirection/substitution or unscoped writes remain denied.
- Path targets now canonicalize through their nearest existing ancestor before containment checks, closing symlink escapes while allowing the canonical `ctx.directory/.omo/evidence/**` root even when the qa-executor session runs in a disposable temp worktree.
- Real OpenCode source-plugin QA must spawn `qa-executor` through `task(subagent_type="qa-executor")`; `opencode run --agent qa-executor` falls back because the reviewer is intentionally subagent-only.
