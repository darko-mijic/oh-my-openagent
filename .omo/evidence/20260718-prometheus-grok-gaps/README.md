# Evidence: Prometheus Grok 4.5 review-gap fixes

**Date:** 2026-07-18
**Branch:** feat/grok-4.5-basic-support
**Goal:** Address validated review gaps (scaffold bash, workflow reminder, fallback effort, docs/tests)

**Evidence status:** Narrative-only. This folder does not contain the raw unit,
typecheck, or doctor outputs cited below. Treat
`../20260718-prometheus-grok-reasoning-effort/` and
`../20260718-grok45-review-claim-fixes/` as the retained machine evidence for
the overlapping fallback-effort and Prometheus behavior.

## What was tested

### Unit (bun test)
```bash
bun test \
  packages/omo-opencode/src/plugin-handlers/tool-config-handler.test.ts \
  packages/omo-opencode/src/plugin-handlers/tool-config-handler-display-name.test.ts \
  packages/omo-opencode/src/plugin-handlers/prometheus-agent-config-builder.test.ts \
  packages/omo-opencode/src/hooks/prometheus-md-only/index.test.ts \
  packages/omo-opencode/src/hooks/prometheus-md-only/bash-command-policy.test.ts \
  packages/omo-opencode/src/hooks/model-fallback/ \
  packages/omo-opencode/src/hooks/runtime-fallback/retry-model-payload.test.ts \
  packages/omo-opencode/src/agents/prometheus/system-prompt.test.ts \
  packages/omo-opencode/src/agents/grok-config-shape.test.ts
```
Result: **148 pass, 0 fail**

### Typecheck
```bash
bun run typecheck
```
Result: exit 0 (root + packages including omo-opencode + model-core)

### Local plugin rebuild + doctor
```bash
~/.config/opencode/doc/omo-local-plugin.sh refresh
```
Result: rebuild ok; doctor configuration valid; prometheus: `xai/grok-4.5 (high)` snapshot-backed
Artifact: `~/.config/opencode/doc/doctor-local-20260718.txt`

### Module driver (fallback effort)
Prior agent also left: `.omo/evidence/20260718-prometheus-grok-reasoning-effort/` with driver proving chain entry + apply path + clear path.

## What was observed

| Scenario | Result |
|----------|--------|
| S1 Grok Prometheus config | `reasoningEffort: "high"` + Grok process law overlay + scaffold mention |
| S2 Bash permissions | Map allows `*scaffold-plan.mjs*`, denies `*`; `interactive_bash: deny`; hook allows node/bun scaffold, denies `rm` and chained commands |
| S3 Workflow reminder | ulw-plan 7-step (SKILL FIRST → … → DUAL REVIEW Momus+Oracle); not stale INTERVIEW→METIS pre-plan machine |
| S4 model-fallback effort | `applyFallbackToChatMessage` writes session prompt params `reasoningEffort` |
| S5 AGENTS.md | Documents overlay + bash policy |

## Why it is enough

- Critical process blocker (bash deny vs scaffold mandate) fixed at permission + hook layers
- Competing stale workflow reminder rewritten to match ulw-plan
- Fallback effort loss fixed at chain entry + apply path + runtime Grok default
- Regression tests pin each surface
- Local plugin rebuilt and doctor confirms Prometheus still on Grok high

## What was omitted

- Full Matrix C live Grok Prometheus session (still open; requires interactive Grok planning session scoring §8 checklist)
- Public upstream PR (user deferred)
- Unrelated dirty working-tree files left unstaged: `assets/oh-my-opencode.schema.json`, `packages/omo-codex/scripts/install-dist/install-local.mjs`, `.local-ignore/`
- The installer artifact is also stale on clean `dev`: root version `4.19.0`
  does not match its embedded `4.18.2`. This narrative pack does not claim to
  repair that upstream generated-file drift.

## Residual risk

- OpenCode host bash pattern matcher may treat keys as program names; md-only bash gate is the defense-in-depth SoT for allow/deny
- Live planning quality on Grok still unproven until Matrix C
