# Evidence: Prometheus Grok reasoningEffort preservation on fallback

**Date:** 2026-07-18
**Slug:** `20260718-prometheus-grok-reasoning-effort`
**Scope:** model-core Prometheus Grok chain + model-fallback chat handler + runtime-fallback retry payload

## What was tested

1. **Unit regressions (bun test)** for:
   - `packages/omo-opencode/src/plugin-handlers/prometheus-agent-config-builder.test.ts`
   - `packages/omo-opencode/src/hooks/runtime-fallback/retry-model-payload.test.ts`
   - `packages/omo-opencode/src/hooks/model-fallback/`
   - filtered `packages/model-core/src/model-requirements-agents.test.ts` prometheus/grok cases
2. **Library driver** (`.omo/evidence/20260718-prometheus-grok-reasoning-effort/driver.ts`) importing production modules and exercising:
   - Prometheus Grok fallback entry carries `reasoningEffort: "high"`
   - `buildRetryModelPayload("xai/grok-4.5", {})` defaults `reasoningEffort` to `"high"`
   - `applyFallbackToChatMessage` writes session prompt params `options.reasoningEffort === "high"`
   - subsequent fallback without effort fields clears session prompt params

## What was observed

- Filtered bun tests: **8 pass / 0 fail** (artifact: `bun-test-filtered.txt`)
- Full targeted suites (excluding pre-existing unrelated length asserts in model-requirements-agents for sisyphus/atlas):
  - model-fallback + retry-model-payload + prometheus-agent-config-builder: **37 pass / 0 fail**
- Driver output (`driver-output.json`):
  - `prometheusGrok.reasoningEffort === "high"`
  - `retryPayload.reasoningEffort === "high"`
  - `clearedAfterNoEffortFallback === true`

## Why it is enough

This change is pure library/hook logic (no new CLI surface, no TUI, no live provider call). The matching surface is importing the modules and asserting the machine-consumed fields (`reasoningEffort`, session prompt params). Full OpenCode spawn would only re-exercise the same pure functions behind chat.message / retry dispatch.

## Residual risk

- Pre-existing failures remain in `model-requirements-agents.test.ts` for sisyphus chain length (expected 8, got 9) and atlas chain length (expected 6, got 7). Unrelated to this change (only Prometheus Grok entry gained `reasoningEffort`).
- Live provider acceptance of Grok `reasoningEffort: "high"` is not re-probed against xAI in this evidence set.

## Isolation

No opencode process was spawned; real `~/.local/share/opencode/opencode.db` was not touched.
