---
name: prometheus-agent
description: Developer reference for the Prometheus strategic planner agent thin prompt adapter and ulw-plan skill dependency.
---

# src/agents/prometheus/ -- Strategic Planner

**Generated:** 2026-05-24 | **Updated:** 2026-07-18 (Grok process overlay + scaffold bash policy)

## OVERVIEW

Prometheus is the interview-mode strategic planner. This directory is a thin OpenCode adapter over one harness-neutral prompt asset:
[`packages/prompts-core/prompts/prometheus/default.md`](../../../../prompts-core/prompts/prometheus/default.md).

The prompt is intentionally small. It identifies Prometheus as the planner, keeps plan mode sticky, and requires the path-backed [`ulw-plan`](../../../../shared-skills/skills/ulw-plan/SKILL.md) skill for the planning mechanics: exploration, clear/unclear intent routing, approval gate, plan scaffold, review flow, and final `.omo` plan output.

This shape follows the package layering refactor in [`ROADMAP.md`](../../../../../ROADMAP.md): prompts are harness-neutral core assets, shared planning behavior lives in the skill layer, and the OpenCode adapter keeps only runtime integration.

## FILES

| File | Purpose |
|------|---------|
| `index.ts` | Barrel exports |
| `system-prompt.ts` | Thin loader using `loadPromptSync()` from `@oh-my-opencode/prompts-core`; `getPrometheusPrompt()` always loads `default.md`, then optionally appends the Grok process overlay |
| `system-prompt.test.ts` | Runtime behavior tests for the thin-shell loader and Grok overlay contract |
| `grok-process-overlay.ts` | Additive Grok process-law overlay (scaffold, CLEAR, anti-compression) |
| `bash-permission.ts` | `PROMETHEUS_BASH_PERMISSION` pattern map (`scaffold-plan.mjs` allow, `*` deny) |
| `packages/prompts-core/prompts/prometheus/default.md` | Shared thin Prometheus markdown prompt asset |
| `packages/shared-skills/skills/ulw-plan/SKILL.md` | Path-backed skill containing the full planning workflow |

## PROMPT LOADING

`getPrometheusPrompt(model, disabledTools)` always loads the shared thin shell from `packages/prompts-core/prompts/prometheus/default.md` via `loadPromptSync`.

When `isGrokModel(model)` is true, it appends `PROMETHEUS_GROK_PROCESS_OVERLAY` from `grok-process-overlay.ts`. That overlay is additive only. `ulw-plan` remains the source of truth for planning mechanics. If overlay and skill disagree, follow the skill and the stricter process reading.

Keep `default.md` as the shared thin shell for all models. Do not grow a family of model-specific markdown prompt files or copy full prompt bodies into the adapter. The Grok overlay is an intentional exception for process compression failures (Grok skipping scaffold, CLEAR interview, and decision-complete plan output). Prefer skill/reference updates for workflow changes; use adapter-side routing only for this kind of model-specific process restatement.

## ULW-PLAN DEPENDENCY

The prompt requires Prometheus to load `ulw-plan` as its first action with the skill tool. The skill is the source of truth for:

- Explore-first planning and when to ask the user
- Clear versus unclear intent routing
- Approval-gated plan generation
- Plan/draft scaffold creation under `.omo/`
- High-accuracy review expectations
- Worker-ready task graphs and verification criteria

Prometheus itself stays a planner. It reads, searches, and writes planning artifacts only; implementation belongs to downstream workers after explicit start-work approval.

## BASH POLICY

- `PROMETHEUS_BASH_PERMISSION` is a pattern map: allow only commands matching `*scaffold-plan.mjs*`; deny `*`.
- `interactive_bash` is denied for Prometheus.
- `prometheus-md-only` also enforces the bash allowlist for `scaffold-plan.mjs` (scaffold via the ulw-plan script, not free-form shell).
- Category task ban remains: Prometheus must not use `task(category=...)`. Allowed children are explore, librarian, metis, momus, and oracle (review).

## KEY CONSTRAINTS

- May ONLY create/edit `.md` files (enforced by hook)
- FORBIDDEN paths: `src/`, `package.json`, config files
- Must explore codebase before planning (NEVER plan blind)
- Plans saved to `.omo/plans/`
- Acceptance criteria requiring "user manually tests" are FORBIDDEN
- Prompt edits belong in [`packages/prompts-core/prompts/prometheus/default.md`](../../../../prompts-core/prompts/prometheus/default.md), not in TypeScript section files
- Planning mechanics belong in the path-backed [`ulw-plan`](../../../../shared-skills/skills/ulw-plan/SKILL.md) skill
- Grok-only process restatement lives in `grok-process-overlay.ts` (additive; does not replace ulw-plan)
- Bash is limited to the scaffold-plan script; see BASH POLICY

## PLAN OUTPUT FORMAT

The `ulw-plan` skill instructs Prometheus to produce `.omo` markdown plans with a parallel task graph:

- Waves (parallel execution groups)
- Tasks with dependencies, category, skills
- Each task has atomic scope + verification criteria
