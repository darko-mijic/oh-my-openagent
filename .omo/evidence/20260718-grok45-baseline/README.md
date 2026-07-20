# Evidence: Grok 4.5 / xAI baseline + early matrix

**Date:** 2026-07-18
**Machine:** macOS, opencode 1.18.3, plugin 4.19.0, xAI oauth connected

## What was tested

1. **Pre-Grok doctor** with existing Kimi/GPT user profile
2. **User-level Grok experimental profile** installed (with backup)
3. **Post-pin doctor** effective model resolution
4. **Isolated XDG live smokes** against `xai/grok-4.5` (host `opencode.db` session count unchanged at 1)
5. **Settings compatibility** unit probe via model-core heuristics for `grok-4.5`
6. **Source audit** of Sisyphus / Junior agent factory for non-GPT path

## Config changes (user-level)

- **Backup:** `~/.config/opencode/oh-my-openagent.json.backup-pre-grok45-20260718`
- **Side copy:** `~/.config/opencode/oh-my-openagent.grok45-experimental.json`
- **Active:** `~/.config/opencode/oh-my-openagent.json` now pins:
  - agents: `sisyphus`, `atlas`, `prometheus`, `sisyphus-junior` → `xai/grok-4.5`
  - categories: `writing`, `unspecified-high`, `quick` → `xai/grok-4.5`
  - Prior `fallback_models` retained from the previous profile

To restore previous stack:
```bash
cp ~/.config/opencode/oh-my-openagent.json.backup-pre-grok45-20260718 \
   ~/.config/opencode/oh-my-openagent.json
```

## Observed

### Matrix A — config resolution: PASS

| Check | Result |
|-------|--------|
| Pre doctor | Sisyphus/Atlas/Prometheus on `kimi-for-coding/k3`; writing on `opencode/kimi-k2.6` |
| Post doctor | Sisyphus/Atlas/Prometheus/Junior on `xai/grok-4.5` with expected variants; writing/unspecified-high/quick on Grok |
| Capability source | **heuristic-backed** for all Grok pins (snapshot lacks `grok-4.5`) |
| Isolation | Host sessions stayed `1`; sandbox sessions grew to `3` |

Artifacts: `doctor-baseline-pre-grok.txt`, `doctor-after-grok-pin.txt`, `isolation-matrix.txt`

### Matrix B — request shape: PARTIAL

| Check | Result |
|-------|--------|
| Live reasoning tokens | Smoke used `reasoning: 20` then `60` on config-path run — Grok reasoning is live |
| Heuristic family | `detectHeuristicModelFamily("grok-4.5")` → `grok` with variants/reasoningEfforts low/medium/high |
| `reasoningEffort: high` compat | Preserved for Grok (`settings-compat-grok.jsonl`) |
| Claude thinking pollution (source) | **CONFIRMED RISK:** Sisyphus fallback + Junior default apply `buildClaudeThinkingConfig` for non-GPT/non-GLM models. There is no `isGrokModel` branch. Live runs still succeeded; xAI may ignore Anthropic thinking blobs, but this is incorrect plumbing. |
| Snapshot | No `xai/grok-4.5` entry in bundled capabilities |

Artifacts: `settings-compat-grok.jsonl`, `run-smoke*.jsonl`, source audit notes below

### Matrix C — role behavior (early): PASS for basic paths

| Case | Result |
|------|--------|
| Direct model smoke `-m xai/grok-4.5` | `GROK45_OK` |
| Config-path (no `-m`) | `CONFIG_PATH_OK — Grok` (proves agent pin works) |
| Writing/edit with tools | 3 tool_use steps; README rewritten; printed DONE |

Artifacts: `run-smoke.jsonl`, `run-config-path.jsonl`, `run-writing-edit.jsonl`, analyses

### Not yet run

- Full Prometheus planning interview
- Atlas multi-task orchestration / idle continuation
- Nested Sisyphus todo + explore + junior
- Category `task(category="writing")` via parent agent (only model-level write smoke so far)
- Fallback chain hop under forced error

## Why enough (for Phase 0 + partial Phase 1)

- User-level pin path works end-to-end with live xAI oauth and Grok 4.5
- Tool use + short reasoning work
- Isolation proof holds
- Clear code-level gaps justify **PR1 correctness** even before full Matrix C

## Decision gate (preliminary)

| Finding | Implication |
|---------|-------------|
| Config pins work today | Local QA can continue without upstream |
| heuristic-backed only | PR1: supplemental capabilities / refresh for `grok-4.5` |
| No `isGrokModel`; Claude thinking path | PR1: family detector + agent config builders |
| Basic tool/edit works | Junior/writing optional chain entries are plausible after more Matrix C |
| Orchestrators untested | Do **not** promote Grok as Sisyphus default yet |

## Secrets omitted

- `auth.json` not copied into evidence
- No tokens/API keys in artifacts

## Source audit (Claude thinking on Grok)

- `packages/omo-opencode/src/agents/sisyphus-agent-factory.ts` `resolveSisyphusPromptFamily`: Grok → `"fallback"` → `buildClaudeSisyphusAgentConfig` (adds Claude thinking)
- `packages/omo-opencode/src/agents/sisyphus-junior/agent.ts`: Grok → `"default"` prompt + `buildClaudeThinkingConfig`
- `packages/model-core/src/model-family-detectors.ts`: no `isGrokModel`
- `packages/model-core/src/model-capability-heuristics.ts`: Grok family exists (PR #4186)

## Local code correctness (in-tree, not yet PR)

Implemented on working tree (not committed):

- `isGrokModel()` in model-core
- Sisyphus family `"grok"` → `buildGrokSisyphusAgentConfig` (`reasoningEffort`, no Claude thinking)
- Sisyphus-Junior Grok branch → `reasoningEffort` (override-aware), no Claude thinking
- Heuristic Grok `supportsThinking: false`
- Supplemental capabilities for `xai/grok-4.5` and `grok-4.5`
- Tests: family detectors, settings compat, `agents/grok-config-shape.test.ts` (3 pass)

### Unit results

- `model-family-detectors` + `model-settings-compatibility`: 86 pass
- `grok-config-shape.test.ts`: 3 pass

### Still open for Matrix C

- Prometheus plan session
- Atlas multi-task orchestration / idle
- Full Sisyphus nested orchestration

## Coverage of Prometheus process failure (2026-07-18 host notes)

Host finding: Grok as Prometheus produced a thin draft (~5–10% of Kimi K3 plan quality)
due to ulw-plan process compression, not schema/tool wiring.

Branch response (commits c6e38db69 + 828104694 on `feat/grok-4.5-basic-support`):

| Host failure | Branch mitigation |
|--------------|-------------------|
| No process law for Grok brain | Prometheus **Grok process overlay** restates scaffold, CLEAR interview, architecture lanes, post-approval Metis/todos |
| `task(category=)` / General Task scaffold | **Hard ban** in `prometheus-md-only` for any `task` with `category` |
| Settings Claude thinking on Grok | Fixed earlier |
| Atlas/Sisyphus/Junior untested path | Grok overlays + Junior uses GPT-5.5 body |
| No chain visibility for xAI | Experimental `grok-4.5` rungs on Prometheus, Atlas, Sisyphus, Junior, writing, deep, ultrabrain, unspecified-high |

**Still require live Matrix C** to claim quality: re-run self-hosting phase-2 brief on this build and score §9 acceptance checklist. Overlay + ban are necessary, not sufficient proof.
