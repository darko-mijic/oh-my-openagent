# QA Evidence - chore(codex): refresh generated installer and codegraph export order

## What was tested

Generated-only Codex rebuilds already present on the `dev` checkout:

- `packages/omo-codex/plugin/components/codegraph/dist/cli.js`
- `packages/omo-codex/plugin/components/codegraph/dist/serve.js`
- `packages/omo-codex/scripts/install-dist/install-local.mjs`

No source under `packages/omo-codex/src/` or `plugin/components/codegraph/src/` changed. The diffs are bun export-map reorder plus the generated installer source-hash stamp.

Codex-connected surface, so `codex-qa` ran in strict isolation (`CODEX_HOME` temp sandbox + local mock model, never the real `~/.codex`):

1. `.agents/skills/codex-qa/scripts/lib/common.sh --self-check`
2. `.agents/skills/codex-qa/scripts/install-verify.sh --self-test`
3. `.agents/skills/codex-qa/scripts/hook-unit-probe.sh --self-test`
4. `.agents/skills/codex-qa/scripts/app-server-drive.sh --plugin`
5. Hermetic gate: `bun run test:codex`
6. `git diff --check`

## What was observed

### Isolation
- Real `~/.codex/config.toml` sha before QA: `eed07cc7677ec511fbf734570af08f6314cd82ca`
- Real sha after every isolated script: `eed07cc7677ec511fbf734570af08f6314cd82ca`
- Isolated homes lived under `/var/folders/.../T/cqa-home.XXXXXX.*` and were removed on exit.

### common.sh --self-check (`common-self-check.txt`)
- PASS: isolated `CODEX_HOME` auto-removed
- PASS: `CODEX_HOME` not `~/.codex`
- PASS: mock model served Responses SSE
- PASS: real home unchanged
- FAIL: missing `tmux` (TUI smoke dependency only; not used for this change)

### install-verify.sh --self-test (`install-verify.txt`)
- PASS: plugin cache present (`5.0.0-beta.7`)
- PASS: isolated `config.toml` enables `omo@sisyphuslabs`
- PASS: 10 component bins linked in sandbox
- PASS: agent TOMLs linked
- PASS: real home unchanged
- EXIT 0

### hook-unit-probe.sh --self-test (`hook-unit-probe.txt`)
- PASS: ultrawork `UserPromptSubmit` injected `<ultrawork-mode>` on an `ulw` prompt
- PASS: real home unchanged
- EXIT 0

### app-server-drive.sh --plugin (`app-server-drive.json`)
- Isolated local install, then a live `codex app-server` turn against the mock model
- `ok: true`, `turnStatus: completed`
- Assistant text: `Hello from the codex-qa mock model.`
- Expected hooks `sessionStart,userPromptSubmit` both completed; `missingHooks: []`, `failedHooks: []`
- Live codegraph SessionStart hook completed: `hooks/session-start-checking-codegraph-bootstrap.json`
- Additional completed hooks: rules, telemetry, auto-update, bootstrap, ultrawork, ulw-loop, stop continuation
- PASS: real home unchanged
- EXIT 0

### git diff --check
Clean. No whitespace errors.

### bun run test:codex
- Initial captured run (`test-codex.txt`) exposed a real CodeGraph child-exit/stdout-drain race: one lifecycle test timed out before the parent output write started.
- After the lifecycle fix, the gate exposed two host-dependent test assumptions that were also fixed instead of retried:
  - “Bun absent” wrapper tests could still discover `/opt/homebrew/bin/bun`; the installer now accepts an injected absolute-candidate list and absence fixtures pass an empty list.
  - TOML assertions required Python 3.11 `tomllib`; both migration suites now use the project runtime’s `Bun.TOML.parse`.
- Final authoritative `bun run test:codex`: EXIT 0.
- Final Node phase: 519 tests passed, 0 failed, 0 skipped.
- Focused proof before the full gate:
  - CodeGraph lifecycle: 2 passed.
  - CodeGraph component: 78 passed.
  - Runtime wrapper links: 21 passed.
  - Subagent-limit migration: 17 passed.
  - Full config migration: 54 passed.

### Post-fix live QA
- `.agents/skills/codex-qa/scripts/install-verify.sh --self-test`: PASS; 10 component bins and agent TOMLs linked in an isolated `CODEX_HOME`.
- `.agents/skills/codex-qa/scripts/app-server-drive.sh --plugin`: `ok: true`, `turnStatus: completed`, mock assistant response observed, and `sessionStart`, `userPromptSubmit`, and `stop` hooks completed.
- Real `~/.codex/config.toml` remained unchanged during each isolated post-fix script (`6354f9d98497ac5fa8ce39bdbe1413214753f78a` before and after).

## Why it is enough

The generated changes exposed one production bridge race and two non-hermetic test assumptions, so the final change includes their minimal source/test fixes plus rebuilt artifacts. Install-verify proves the rebuilt `install-local.mjs` still lands the local plugin into an isolated Codex home. The post-fix live app-server turn proves the rebuilt codegraph `dist/cli.js` still wires and completes hooks on a real Codex process. `test:codex` is the hermetic installer + component gate and now passes completely.

## What was omitted

- `scripts/tui-smoke.sh`: host has no `tmux`. TUI boot is not in the blast radius of generated export-order rebuilds; first-party proof is the app-server notification stream.
- Docker QA (`script/agent/qa-docker.sh`): Docker unavailable on this host. Local isolated scripts are the documented fallback.
- Raw install logs and mock-model transcripts: they contain only sandbox paths; not copied. No tokens, API keys, or auth headers observed.
- OpenCode QA: no `packages/omo-opencode/` files changed.
