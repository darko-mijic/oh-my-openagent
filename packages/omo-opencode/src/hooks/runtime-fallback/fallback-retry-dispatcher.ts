import type { AutoRetryHelpers } from "./auto-retry"
import type { AutoRetryDispatchOutcome, HookDeps, FallbackState } from "./types"
import type { FallbackModelObject } from "../../config/schema/fallback-models"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { prepareFallback } from "./fallback-state"
import { restoreFallbackState, snapshotFallbackState } from "./fallback-state-snapshot"

type DispatchFallbackRetryOptions = {
  sessionID: string
  state: FallbackState
  fallbackModels: readonly (string | FallbackModelObject)[]
  resolvedAgent?: string
  source: string
}

function resolveDispatchMessage(result: AutoRetryDispatchOutcome, newModel: string): string {
  const modelName = newModel.split("/").pop() || newModel
  if (result.status === "queued") return `Fallback queued for ${modelName}`
  if (result.status === "possibly-accepted") return `Fallback dispatch may have been accepted for ${modelName}`
  return `Switched to ${modelName} for next request`
}

export async function dispatchFallbackRetry(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  options: DispatchFallbackRetryOptions,
): Promise<void> {
  const snapshot = snapshotFallbackState(options.state, options.sessionID)
  const result = prepareFallback(
    options.sessionID,
    options.state,
    options.fallbackModels,
    deps.config,
  )

  if (result.success && result.selectedFallback && result.newModel) {
    const rawDispatchOutcome = await helpers.autoRetryWithFallback(
      options.sessionID,
      result.selectedFallback,
      options.resolvedAgent,
      options.source,
    )
    const dispatchOutcome = rawDispatchOutcome ?? {
      accepted: true,
      status: "dispatched",
    }
    if (rawDispatchOutcome === undefined) {
      log(`[${HOOK_NAME}] Fallback dispatch returned no outcome; treating as accepted for compatibility`, {
        sessionID: options.sessionID,
        source: options.source,
      })
    }
    if (!dispatchOutcome.accepted) {
      const restored = deps.sessionStates.get(options.sessionID) === options.state
        && restoreFallbackState(options.state, snapshot, options.sessionID)
      if (!restored) {
        log(`[${HOOK_NAME}] Skipped stale fallback rollback`, {
          sessionID: options.sessionID,
          source: options.source,
        })
      }
      log(`[${HOOK_NAME}] Fallback dispatch was not accepted`, {
        sessionID: options.sessionID,
        source: options.source,
        status: dispatchOutcome.status,
        reason: dispatchOutcome.reason,
      })
      return
    }
    if (deps.config.notify_on_fallback) {
      await deps.ctx.client.tui
        .showToast({
          body: {
            title: "Model Fallback",
            message: resolveDispatchMessage(dispatchOutcome, result.newModel),
            variant: "warning",
            duration: 5000,
          },
        })
        .catch(() => {})
    }
    return
  }

  log(`[${HOOK_NAME}] Fallback preparation failed`, {
    sessionID: options.sessionID,
    source: options.source,
    error: result.error,
  })
}
