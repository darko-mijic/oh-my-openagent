# Task 14 — Codex QA (ulw-plan role-marker parity)

**Date:** 2026-07-20
**Plan todo:** `.omo/plans/grok45-final-review-gates.md` checkbox 14
**Scope:** Prove regenerated `ulw-plan` scaffold emits F1–F4 role markers, dual-review drift pin is green, isolated local install works, and real `~/.codex/config.toml` is untouched.

## What was tested

1. `bun run test:codex` — full Codex compatibility gate.
2. Dual-review drift pin: `node --test test/ulw-plan-review-state-contract.test.mjs test/scaffold-plan.test.mjs` under `packages/omo-codex/plugin`.
3. Isolated `CODEX_HOME` install via `node packages/omo-codex/scripts/install-local.mjs install --no-tui --no-codex-autonomous`.
4. Scaffold run of the **installed** `scaffold-plan.mjs` under an isolated workspace; assert F1–F4 `<!-- role:... -->` markers.
5. Byte-identity: shared-skills source ↔ plugin skills copy ↔ installed cache copy.
6. Codex reviewer-binding guidance in installed `full-workflow.md` (prompt-level equivalents, not runtime enforcement).
7. codex-qa first-party scripts:
   - `scripts/lib/common.sh --self-check`
   - `scripts/install-verify.sh --self-test` (retry after concurrent-race flake)
   - `scripts/hook-unit-probe.sh --self-test`
   - `scripts/app-server-drive.sh --plugin`
8. sha256 of real `~/.codex/config.toml` before and after the full QA run.

## What was observed

| Assertion | Result | Artifact |
|---|---|---|
| `bun run test:codex` | **512 pass / 0 fail** (exit 0, ~59s) | `test-codex.txt` |
| Dual-review + scaffold pin | **24 pass / 0 fail** (exit 0) | `dual-review-drift-pin.txt` |
| Isolated install | **exit 0**; `omo@sisyphuslabs` enabled; plugin cache `4.19.0` | `isolated-install.txt`, `isolated-install-assertions.txt` |
| Scaffold byte identity | **PASS** plugin≡shared and installed≡plugin | `scaffold-byte-identity.txt` |
| F1–F4 role markers in scaffolded plan | **PASS** all 4 markers + all 4 rows | `scaffold-marker-assertions.txt`, `scaffolded-plan.md` |
| Reviewer-binding guidance | **PASS** lazycodex-* bindings + "prompt-level equivalents" | `reviewer-binding-guidance.txt` |
| hook-unit-probe | **PASS** ultrawork injects `<ultrawork-mode>` | `hook-unit-probe-self-test.txt` |
| app-server-drive --plugin | **ok:true**; hooks `sessionStart`, `userPromptSubmit`, `stop`; `missingHooks: []` | `app-server-drive-plugin.txt` |
| install-verify | First run **FAIL** (concurrent sync-skills race with parallel install); retry **PASS** | `install-verify-self-test.txt`, `install-verify-self-test-retry.txt` |
| Real `~/.codex/config.toml` | **UNCHANGED** sha256 `c60942c49949d55b521cb72d33a573767459cdc20b4751679086c9fb21b4a5c4` | `real-config-toml-shasum-before.txt`, `real-config-toml-shasum-after.txt` |

### Scaffolded plan final-wave excerpt (from installed scaffold)

```markdown
## Final verification wave

- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->
- [ ] F2. Code quality review <!-- role:code-reviewer -->
- [ ] F3. Real manual QA <!-- role:qa-executor -->
- [ ] F4. Scope fidelity <!-- role:scope-auditor -->
```

### Codex binding table (from installed `full-workflow.md`)

Codex treats markers as **prompt-level equivalents, not runtime role enforcement** (DC-4a):

| Final row | Role marker | Codex prompt-level equivalent |
|---|---|---|
| F1 | `plan-auditor` | `lazycodex-gate-reviewer` |
| F2 | `code-reviewer` | `lazycodex-code-reviewer` |
| F3 | `qa-executor` | `lazycodex-qa-executor` |
| F4 | `scope-auditor` | `lazycodex-gate-reviewer` |

## Why it is enough

- Gate suite covers installer, config migration, component CLIs, skill sync, and ulw-plan contracts including role-marker emission and dual-maintained source identity.
- Live isolated install proves the LOCAL build lands `omo@sisyphuslabs` and ships the scaffold that emits markers.
- Running the **installed** scaffold (not only the repo copy) proves the shipped artifact, not just source.
- app-server drive proves plugin hooks fire in a real Codex turn against a mock model (no real API).
- Before/after sha256 proves the host `~/.codex/config.toml` was never written.

## What was omitted / residual risk

- `common.sh --self-check` reported missing `tmux` (TUI smoke not run). Hook proof used app-server instead, which is the first-party method.
- First `install-verify.sh --self-test` failed because it raced a parallel `install-local.mjs` that was also running `sync-skills` (ENOENT on `lcx-doctor/SKILL.md` mid-copy). Solo retry passed. Not a product defect.
- No Codex runtime enforcement of role markers was added or tested (out of scope per DC-4a).
- Full-suite `bun test`: 12001 pass / 1 fail. The single failure is the pre-existing flake `prompt-async-route-audit.test.ts` (default 5s budget). With `--timeout 30000` alone: 10 pass / 0 fail in 5.86s (`bun-test-prompt-async-30s.txt`). Not introduced by this QA todo.
- `bun run typecheck`: exit 0 (see `typecheck.txt`).

## Isolation discipline

- Every Codex process used a throwaway `CODEX_HOME` under `/tmp/cqa-*`.
- Mock model for app-server; no real model API calls.
- Real home only read for sha256/md5 comparison.
- Sandbox path: see `sandbox-path.txt` / `isolated-install-env.txt`.
