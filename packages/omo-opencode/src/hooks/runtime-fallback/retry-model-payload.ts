import { isGrok45Model } from "@oh-my-opencode/model-core"
import { parseModelString } from "../../shared/model-string-parser"
import type { FallbackModelObject } from "../../config/schema/fallback-models"

type RetryModelSettings = Pick<FallbackModelObject, "variant" | "reasoningEffort">

const EFFORT_VARIANTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"])

export function buildRetryModelPayload(
  model: string,
  selectedEntry?: RetryModelSettings,
  agentSettings?: { variant?: string; reasoningEffort?: string },
): { model: { providerID: string; modelID: string }; variant?: string; reasoningEffort?: string } | undefined {
  const parsedModel = parseModelString(model)
  if (!parsedModel) {
    return undefined
  }

  const variant = selectedEntry?.variant ?? parsedModel.variant ?? agentSettings?.variant
  const variantEffort = variant && EFFORT_VARIANTS.has(variant) ? variant : undefined
  const configuredEffort = selectedEntry?.reasoningEffort ?? agentSettings?.reasoningEffort ?? variantEffort
  const grokDefault = isGrok45Model(`${parsedModel.providerID}/${parsedModel.modelID}`) && variant !== "low"
    ? "high"
    : undefined
  const requestedEffort = configuredEffort ?? grokDefault
  const reasoningEffort = variant === "low" && ["high", "xhigh", "max"].includes(requestedEffort ?? "")
    ? "low"
    : requestedEffort

  const payload: { model: { providerID: string; modelID: string }; variant?: string; reasoningEffort?: string } = {
    model: {
      providerID: parsedModel.providerID,
      modelID: parsedModel.modelID,
    },
  }

  if (variant) {
    payload.variant = variant
  }
  if (reasoningEffort) {
    payload.reasoningEffort = reasoningEffort
  }

  return payload
}
