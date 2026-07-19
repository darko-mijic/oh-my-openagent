import type { HookDeps } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import {
  createFallbackState,
  getSelectedFallbackProviderModel,
  isModelInCooldown,
} from "./fallback-state"
import { buildRetryModelPayload } from "./retry-model-payload"
import { applyRuntimeFallbackPromptParams } from "../../shared/session-prompt-params-helpers"
import { clearRuntimeFallbackPromptParams } from "../../shared/session-prompt-params-state"

export function createChatMessageHandler(deps: HookDeps) {
  const { config, sessionStates, sessionLastAccess } = deps

  return async (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
    output: { message: { model?: { providerID: string; modelID: string }; variant?: string }; parts?: Array<{ type: string; text?: string }> }
  ) => {
    if (!config.enabled) return

    const { sessionID } = input
    let state = sessionStates.get(sessionID)

    if (!state) return

    sessionLastAccess.set(sessionID, Date.now())

    const requestedModel = input.model
      ? `${input.model.providerID}/${input.model.modelID}`
      : undefined
    const agentSettings = input.agent
      ? deps.pluginConfig?.agents?.[input.agent as keyof NonNullable<typeof deps.pluginConfig.agents>]
      : undefined
    const selectedPayload = state.selectedFallback
      ? buildRetryModelPayload(state.currentModel, state.selectedFallback.entry, agentSettings ? {
          variant: agentSettings.variant,
          reasoningEffort: agentSettings.reasoningEffort,
        } : undefined)
      : buildRetryModelPayload(state.currentModel)
    const selectedModel = selectedPayload
      ? `${selectedPayload.model.providerID}/${selectedPayload.model.modelID}`
      : state.currentModel

    if (
      requestedModel &&
      state.pendingFallback &&
      requestedModel === getSelectedFallbackProviderModel(state.pendingFallback)
    ) {
      state.pendingFallback = undefined
      state.pendingFallbackModel = undefined
      state.pendingFallbackPromptMayHaveBeenAccepted = false
    }

    if (requestedModel && requestedModel !== selectedModel) {
      log(`[${HOOK_NAME}] Detected manual model change, resetting fallback state`, {
        sessionID,
        from: state.currentModel,
        to: requestedModel,
      })
      if (state.runtimePromptParamsApplied) {
        clearRuntimeFallbackPromptParams(sessionID)
      }
      state = createFallbackState(requestedModel)
      sessionStates.set(sessionID, state)
      return
    }

    if (
      config.restore_primary_after_cooldown &&
      state.currentModel !== state.originalModel &&
      !state.pendingFallback &&
      !isModelInCooldown(state.originalModel, state, config.cooldown_seconds)
    ) {
      const activeModel = state.originalModel
      log(`[${HOOK_NAME}] Restoring preferred primary model`, {
        sessionID,
        from: state.currentModel,
        to: activeModel,
      })
      if (state.runtimePromptParamsApplied) {
        clearRuntimeFallbackPromptParams(sessionID)
      }
      sessionStates.set(sessionID, createFallbackState(activeModel))

      const primaryPayload = buildRetryModelPayload(activeModel)
      if (primaryPayload) {
        output.message.model = primaryPayload.model
        if (primaryPayload.variant) {
          output.message.variant = primaryPayload.variant
        } else {
          delete output.message.variant
        }
      }
      return
    }

    const activeModel = state.currentModel

    if (activeModel === state.originalModel) return

    log(`[${HOOK_NAME}] Applying fallback model override`, {
      sessionID,
      from: input.model,
      to: activeModel,
    })

    if (output.message && activeModel && selectedPayload) {
      output.message.model = selectedPayload.model
      if (selectedPayload.variant) {
        output.message.variant = selectedPayload.variant
      } else {
        delete output.message.variant
      }
      if (selectedPayload.reasoningEffort) {
        applyRuntimeFallbackPromptParams(sessionID, { reasoningEffort: selectedPayload.reasoningEffort })
        state.runtimePromptParamsApplied = true
      } else if (state.runtimePromptParamsApplied) {
        clearRuntimeFallbackPromptParams(sessionID)
        state.runtimePromptParamsApplied = false
      }
    }
  }
}
