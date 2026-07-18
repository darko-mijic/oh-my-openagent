import { isGrokModel } from "@oh-my-opencode/model-core"
import { loadPromptSync, prometheusPromptVariants } from "@oh-my-opencode/prompts-core"
import { PROMETHEUS_BASH_PERMISSION } from "./bash-permission"
import { PROMETHEUS_GROK_PROCESS_OVERLAY } from "./grok-process-overlay"

export { PROMETHEUS_BASH_PERMISSION } from "./bash-permission"

export const PROMETHEUS_PERMISSION = {
  edit: "allow" as const,
  bash: PROMETHEUS_BASH_PERMISSION,
  webfetch: "allow" as const,
  question: "allow" as const,
}

function loadDefaultPrometheusPrompt(): string {
  return loadPromptSync({
    source: prometheusPromptVariants.default,
    name: "prometheus",
    variant: "default",
  }).body
}

export const PROMETHEUS_SYSTEM_PROMPT = loadDefaultPrometheusPrompt()

/**
 * Thin Prometheus shell for all models. Grok gets an additive process overlay
 * so multi-phase ulw-plan discipline is restated without replacing the skill.
 */
export function getPrometheusPrompt(model?: string, disabledTools?: readonly string[]): string {
  void disabledTools
  if (model && isGrokModel(model)) {
    return `${PROMETHEUS_SYSTEM_PROMPT}\n\n${PROMETHEUS_GROK_PROCESS_OVERLAY}`
  }
  return PROMETHEUS_SYSTEM_PROMPT
}
