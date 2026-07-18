import { log } from "../../shared/logger"
import { getTaskToastManager } from "../../features/task-toast-manager"
import { applySessionPromptParams } from "../../shared/session-prompt-params-helpers"
import type { ChatMessageHandlerOutput, ChatMessageInput } from "../../plugin/chat-message"

type FallbackModelSelection = {
  providerID: string
  modelID: string
  variant?: string
  reasoningEffort?: string
  temperature?: number
  top_p?: number
  maxTokens?: number
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number }
}

export async function applyFallbackToChatMessage(params: {
  input: ChatMessageInput
  output: ChatMessageHandlerOutput
  fallback: FallbackModelSelection
  toast?: (input: {
    title: string
    message: string
    variant?: "info" | "success" | "warning" | "error"
    duration?: number
  }) => void | Promise<void>
  onApplied?: (input: {
    sessionID: string
    providerID: string
    modelID: string
    variant?: string
  }) => void | Promise<void>
  lastToastKey: Map<string, string>
}): Promise<void> {
  const { input, output, fallback, toast, onApplied, lastToastKey } = params
  const { sessionID } = input
  if (!sessionID) return

  output.message["model"] = {
    providerID: fallback.providerID,
    modelID: fallback.modelID,
  }
  if (fallback.variant !== undefined) {
    output.message["variant"] = fallback.variant
  } else {
    delete output.message["variant"]
  }

  const hasEffortFields =
    fallback.reasoningEffort !== undefined ||
    fallback.temperature !== undefined ||
    fallback.top_p !== undefined ||
    fallback.maxTokens !== undefined ||
    fallback.thinking !== undefined

  if (hasEffortFields) {
    applySessionPromptParams(sessionID, {
      reasoningEffort: fallback.reasoningEffort,
      temperature: fallback.temperature,
      top_p: fallback.top_p,
      maxTokens: fallback.maxTokens,
      thinking: fallback.thinking,
    })
  } else {
    applySessionPromptParams(sessionID, undefined)
  }

  if (toast) {
    const key = `${sessionID}:${fallback.providerID}/${fallback.modelID}:${fallback.variant ?? ""}`
    if (lastToastKey.get(sessionID) !== key) {
      lastToastKey.set(sessionID, key)
      const variantLabel = fallback.variant ? ` (${fallback.variant})` : ""
      await Promise.resolve(
        toast({
          title: "Model fallback",
          message: `Using ${fallback.providerID}/${fallback.modelID}${variantLabel}`,
          variant: "warning",
          duration: 5000,
        }),
      )
    }
  }

  if (onApplied) {
    await Promise.resolve(
      onApplied({
        sessionID,
        providerID: fallback.providerID,
        modelID: fallback.modelID,
        variant: fallback.variant,
      }),
    )
  }

  const toastManager = getTaskToastManager()
  if (toastManager) {
    const variantLabel = fallback.variant ? ` (${fallback.variant})` : ""
    toastManager.updateTaskModelBySession(sessionID, {
      model: `${fallback.providerID}/${fallback.modelID}${variantLabel}`,
      type: "runtime-fallback",
    })
  }

  log("[model-fallback] Applied fallback model: " + JSON.stringify(fallback))
}
