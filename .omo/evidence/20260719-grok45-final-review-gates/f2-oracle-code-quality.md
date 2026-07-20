# F2 — Code Quality Review (oracle)

**Reviewer:** oracle (session ses_08157d8dfffePM840KIBRmCDR8, round 5)
**Date:** 2026-07-20
**VERDICT: APPROVE**

## Verdict history

| Round | Session | Verdict | Blocker |
|---|---|---|---|
| R1 | earlier | REJECT | reviewerScopeGuard created but never dispatched |
| R2 | ses_0821f151affer3YQkPni7cbZ4Q | REJECT | `git diff --check dev...HEAD` whitespace errors in committed evidence |
| R3 | ses_081bf101affeRMJQhjxuXMJMvn | REJECT | stale receipts counted — isReceiptValid never wired into gating |
| R4 | ses_081778ef0ffeIpMHkUoVQ6Roje | REJECT | implicit code-reviewer scope missed uncommitted/untracked post-approval edits |
| R5 | ses_08157d8dfffePM840KIBRmCDR8 | **APPROVE** | — |

## R5 findings (verbatim summary)

- Round-4 blocker fixed: implicit code-reviewer fingerprints include committed baseline diff paths plus non-`.omo/**` `git status --porcelain -uall` paths (`final-wave-fingerprint.ts:55,134,143-146`); porcelain parsing centralized in `final-wave-canonical-attestation.ts:40-54`.
- Required semantics regression-tested: uncommitted product modification invalidates (`final-wave-enforcement.test.ts:581-591`); untracked product file invalidates (`:594-604`); `.omo/**` churn stays valid (`:607-617`); nogit no-throw (`final-wave-fingerprint.ts:73-78,129`; tests `:560-578`).
- Earlier blockers remain resolved: guard registered (`create-tool-guard-hooks.ts:162-185`), dispatched (`tool-execute-before.ts:71-73`), dispatcher-tested (`tool-execute-before-reviewer-scope-guard.test.ts:72-310`); receipt revalidation centralized in `revalidateReceiptStore` (`final-wave-enforcement.ts:232-248`) and used at `:126,:141,:151`.
- Quality: `git diff --check` clean; no `as any`/`@ts-ignore` in changed final-wave files; tests given/when/then, behavior-asserting.

## Fixes that resolved each round

- R1 → 63dbee8ef `fix(atlas): wire reviewer-scope-guard and tighten QA write scope`
- R2 → 0eef12a3d `fix(evidence): trim trailing whitespace and EOF blank lines flagged by git diff --check`
- R3 → a9122a6a4 `fix(atlas): revalidate final-wave receipt fingerprints before release gating`
- R4 → 96ffc251e `fix(atlas): fold uncommitted worktree state into implicit code-reviewer receipt scope`

## R6 — external-review remediation verification (oracle session ses_080cc33e4ffeIY7pkAoYF09YSH)

**VERDICT: APPROVE** — all 17 findings from the external consolidated review (Claude Fable, probe-verified) confirmed FIXED with line-level proof:

| Finding | Fix commit | Oracle proof anchor |
|---|---|---|
| CR-1 enforcement demotion bypass | d11c38201 | `final-wave-enforcement.ts:78-86,90-99` blocked; legacy/no-sidecar still advisory `:101-109` |
| CR-2a checkbox invalidation | d11c38201 | `final-wave-fingerprint.ts:193-195` checkbox normalization; markers stay hash-relevant `:185-188` |
| CR-2b stale receipt re-issue | d11c38201 | `final-wave-receipts.ts:207-210` duplicate vs `:227-236` archive+supersede |
| HI-1 attestation baseline | d11c38201 | stamp-time dirt snapshot `final-wave-receipts.ts:325-333`; subtract at `canonical-attestation.ts:37-41` |
| HI-2 F3 evidence livelock | d11c38201 | F3-owned evidence scope `final-wave-fingerprint.ts:155-170` |
| HI-3 sg --rewrite (read-only) | 09c5529ff | unified inspector `qa-command-tokenizer.ts:3,22-24`, both roles wired |
| HI-4 curl escapes | 09c5529ff | default-deny SAFE_CURL_* `qa-command-tokenizer.ts:4-12,26-100` |
| MD-1/MD-2 launch path | 96543230a | work-scoped resolution `tool-execute-before.ts:99-110`; auth before ambiguous-key `:132-156` |
| MD-3 quarantine re-stamp | d11c38201 | marker blocks `enforcement.ts:43-56`; stampBaseline refuses `receipts.ts:145-148` |
| MD-4/MD-5 keys+grammar | d11c38201 | uppercase boundaries `receipts.ts:161-236,397-417`; shared grammar `role-parser.ts:10` + `plan-state.ts:61-64` |
| MD-6/7/8 guard policy | 09c5529ff | `-fprint` prefix denial; bun-run allowlist `qa-command-policy.ts:33,118-121`; `.omo/**` non-executable `qa-path-policy.ts:92-105` |
| HI-5/HI-6 evidence+docs | a0670a543+6d9ec27d8 | backfill files with real suite output; AGENTS.md:49 says 12 agents |
| MD-9 qa-executor chain | a0670a543 | `agent-model-requirements.ts:174-191` plan-letter chain, pinned `model-requirements-agents.test.ts:335-359` |

Quality: no new `as any`/`@ts-ignore`; given/when/then tests; barrel-only index.ts. Orchestrator integrated verification: root `bun test` 12,139 pass / 0 fail, `bun run typecheck` clean, `git diff --check` clean, dist rebuilt 13:03.
