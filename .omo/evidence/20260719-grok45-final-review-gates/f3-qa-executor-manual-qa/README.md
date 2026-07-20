# F3 Manual QA - grok45 final review gates

## WHAT TESTED

- Live OpenCode final-wave enforcement in an isolated XDG sandbox:
  - marked F2 category misroute rejection
  - correctly routed Oracle F2 completion and durable receipt
  - legacy-unmarked advisory passthrough
  - host OpenCode database isolation
- Live OpenCode no-regression polarity:
  - ordinary `task(category=unspecified-high)` routing
  - Sisyphus-Junior and xai/grok-4.5 model selection
  - marked F2 category rejection in the same sandbox
- Isolated Codex component hook, installer, app-server notification, scaffold-marker, and real-config integrity surfaces.
- Remediation probes:
  - CR-1 stamped plan with stripped role markers remains blocked
  - CR-2a F-row checkbox changes do not invalidate receipts
  - CR-2b stale receipt reissue archives and supersedes the prior receipt
- Repository gates:
  - canonical `bun test`
  - canonical `bun run test:codex`
  - canonical `bun run typecheck`
  - disposable-worktree `bun run build`
- Disposable worktree grammar and cleanup behavior.

## WHAT OBSERVED

- Todo 13 produced `QA_PASS marked_reject=yes marked_receipt=yes legacy_no_reject=yes isolation_diff=0`.
- The marked F2 category route was rejected at `tool.execute.before`. The error required `subagent_type="oracle"`, rejected `category="unspecified-high"`, and confirmed that no launch expectation was recorded.
- The correctly routed Oracle child completed with `VERDICT: APPROVE`. Its launch expectation, child binding, actual agent, verdict, and fingerprint were persisted in the durable receipt sidecar.
- The legacy-unmarked F2 category route launched Sisyphus-Junior and returned an explicit unauthenticated advisory notice rather than a hard rejection.
- Todo 13 left the host OpenCode database unchanged at 134 sessions before and after. Five sessions existed only in the isolated sandbox DB.
- Todo 15 produced `QA_PASS nonf_sisyphus_junior_grok=yes marked_f_category_reject=yes isolation_diff=0`.
- The ordinary non-final-wave category task created a Sisyphus-Junior child using provider `xai`, model `grok-4.5`, and variant `high`.
- The marked F2 category route in the same sandbox was hard-rejected without launching a category child.
- Todo 15 left the host OpenCode database unchanged at 134 sessions before and after. Three sessions existed only in the isolated sandbox DB.
- Canonical `bun test` completed with 12,139 pass and 0 fail.
- Canonical `bun run test:codex` completed with 512 pass and 0 fail.
- Canonical `bun run typecheck` exited successfully.
- The disposable-worktree build completed with `build: all steps completed`.
- Todo 14 isolated Codex QA passed, including first-party hook notifications and installer verification.
- The real `~/.codex/config.toml` SHA256 remained unchanged.
- CR-1, CR-2a, and CR-2b focused probes all passed.
- All disposable QA worktrees were removed.

## WHY ENOUGH

The evidence covers both sides of the required polarity through real OpenCode sessions rather than source inspection alone. The marked F-row path is proven by CLI and SSE task errors, while the ordinary non-F path is proven by the created child session's agent and model metadata. The named-reviewer success path is independently bound by matching launch IDs and child session IDs across the fake-call transcript, SSE stream, CLI result, and durable sidecar.

Legacy compatibility is proven by an actual child launch plus the explicit advisory notice. Isolation is proven by unchanged host database counts and separate sandbox databases. The remediation probes cover the fail-closed marker contract and receipt lifecycle edge cases. The canonical test, Codex, typecheck, and worktree build gates cover repository-wide regressions.

The live drivers were executed by the parent Atlas harness, not by the QA reviewer process. This is acceptable because the QA gate requires independent verification of faithful surface evidence, not that the reviewer personally own the shell process. Every supplied artifact was read and cross-checked before approval.

## WHAT OMITTED

- No product code was edited during this QA review.
- No real provider API was called. OpenCode and Codex live checks used local mock providers and isolated homes.
- No secrets, auth tokens, raw environment dumps, or private credentials are reproduced here.
- The Todo 15 fake xAI child emitted a malformed fake Responses event after the correct child route was created. This does not affect the asserted agent/model-routing contract and is retained in `nonf-sse.jsonl` for transparency.
- No TUI visual smoke was included because tmux was unavailable. The behavior under review was asserted through CLI JSONL, HTTP/SSE, app-server notifications, durable sidecars, and parsed metadata instead.
- This README is returned for parent persistence because the current QA process predates the tool-surface fix in commit `8880d060d`.

## manualQa

| Scenario | Status | surfaceEvidence | adversarialCases | artifactRefs |
|---|---|---|---|---|
| QA grammar smoke | pass | Env-prefixed chain, scoped mkdir, worktree add/remove, and allowlisted build were admitted | Default `/tmp` topology and worktree bootstrap | `worktree-path-final.txt`; `worktree-head-final.txt`; `todo15-build-final.txt`; F3 QA session transcript |
| Todo 13 marked category misroute | pass | Live task moved pending to running to error with final-wave named-reviewer rejection | F2 prompt routed through `category=unspecified-high` | `todo13-opencode-final/reject-message.txt`; `todo13-opencode-final/reject-run.jsonl`; `todo13-opencode-final/reject-sse.jsonl` |
| Todo 13 named Oracle completion | pass | Live Oracle child approved and durable receipt matched expectation and binding | Named subagent, launch binding, child identity, verdict, fingerprint | `todo13-opencode-final/receipt-sidecar.json`; `todo13-opencode-final/receipt-run.jsonl`; `todo13-opencode-final/receipt-sse.jsonl`; `todo13-opencode-final/fake-tool-calls.jsonl` |
| Todo 13 legacy-unmarked compatibility | pass | Category task launched with advisory unauthenticated-final-wave notice and no rejection | Legacy plan lacking role markers | `todo13-opencode-final/legacy-no-rejection.txt`; `todo13-opencode-final/legacy-run.jsonl`; `todo13-opencode-final/legacy-sse.jsonl` |
| Todo 13 isolation | pass | Host session count remained 134 to 134; five sessions stayed in sandbox DB | Multiple parent and child sessions | `todo13-opencode-final/isolation.txt` |
| Todo 15 non-F category routing | pass | Created child was Sisyphus-Junior on xai/grok-4.5, variant high | Connected xAI auth and ordinary non-final-wave prompt | `todo15-no-regression-final/nonf-metadata.json`; `todo15-no-regression-final/nonf-sse.jsonl`; `todo15-no-regression-final/nonf-run.jsonl`; `todo15-no-regression-final/agent-list.json` |
| Todo 15 marked category rejection | pass | Same sandbox hard-rejected the marked F2 category route without a child launch | Polarity contrast against ordinary non-F category route | `todo15-no-regression-final/reject-message.txt`; `todo15-no-regression-final/reject-run.jsonl`; `todo15-no-regression-final/reject-sse.jsonl`; `todo15-no-regression-final/fake-tool-calls.jsonl` |
| Todo 15 isolation | pass | Host session count remained 134 to 134; three sessions stayed in sandbox DB | Non-F child and marked rejection in one sandbox | `todo15-no-regression-final/isolation.txt` |
| Todo 14 isolated Codex QA | pass | Component probe, installer verification, and real app-server mock turn passed with no missing hooks | Isolated CODEX_HOME and local model | `todo14-codex/hook-unit-probe-self-test.txt`; `todo14-codex/install-verify-self-test.txt`; `todo14-codex/app-server-drive-plugin.txt` |
| Codex scaffold markers | pass | Generated F1-F4 rows carry fixed parser role markers and dual-maintained copies match | All four reviewer roles and byte-identity drift | `todo14-codex/scaffold-marker-assertions.txt`; `todo14-codex/scaffold-byte-identity.txt`; `todo15-scaffold-markers-final.txt` |
| Real Codex config isolation | pass | SHA256 unchanged before and after isolated Codex QA | Installer and app-server execution | `todo14-codex/real-config-toml-shasum-before.txt`; `todo14-codex/real-config-toml-shasum-final.txt` |
| CR-1 stripped markers | pass | Stamped plan with stripped markers resolved blocked, never advisory | Role-contract loss and unreadable stamped plan | `../task-remediation-batch-a-gate-core.txt`; `packages/omo-opencode/src/hooks/atlas/final-wave-enforcement.test.ts` |
| CR-2a checkbox flip | pass | F1-F4 receipts remained valid after F-row checkbox-state changes | Mixed `[x]`, `[X]`, and `[~]` states | `../task-remediation-batch-a-gate-core.txt`; `packages/omo-opencode/src/hooks/atlas/final-wave-enforcement.test.ts` |
| CR-2b stale receipt reissue | pass | Refreshed receipt was accepted and superseded receipt was archived | Changed scope fingerprint on the same bound row | `../task-remediation-batch-a-gate-core.txt`; `packages/omo-opencode/src/hooks/atlas/final-wave-receipts.test.ts` |
| Canonical Bun suite | pass | 12,139 pass, 0 fail | Aggregate suite after isolated timeout verification | `todo15-bun-test-rerun.txt`; `todo15-repo-gates-final.txt` |
| Canonical Codex gate | pass | 512 pass, 0 fail | Installer, migration, component, MCP, and scaffold suites | `todo14-codex/test-codex-main-repo.txt` |
| Canonical typecheck | pass | Root, script, and package TypeScript checks exited 0 | All registered workspace packages | `todo15-typecheck-final.txt` |
| Disposable-worktree build | pass | Full build ended with `build: all steps completed` | Materialization, CLI, TUI, schemas, MCPs, Senpi, declarations, and Codex plugin | `todo15-build-final.txt`; `worktree-head-final.txt` |
| Prior evidence validation | pass | Earlier Todo 13/14/15 artifacts were parsed and found internally consistent before fresh reruns | CLI, SSE, sidecar, model metadata, and isolation cross-checks | `todo13-opencode-tip/`; `todo14-codex/`; `todo15-no-regression-tip/` |
| Worktree cleanup | pass | Disposable worktree paths were removed after QA | Forced cleanup after generated build outputs | `worktree-path-final.txt`; F3 QA session transcript |

VERDICT: APPROVE
