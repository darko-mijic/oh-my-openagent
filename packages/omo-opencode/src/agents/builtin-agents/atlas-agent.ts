import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared"
import { log } from "../../shared/logger"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution } from "./model-resolution"
import { createAtlasAgent } from "../atlas"
import { setAtlasRuntimePromptContext } from "../atlas-runtime-prompt-reconciler"

export function maybeCreateAtlasConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  userCategories?: CategoriesConfig
  useTaskSystem?: boolean
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    availableAgents,
    availableSkills,
    mergedCategories,
    directory,
    userCategories,
  } = input

  if (disabledAgents.includes("atlas")) return undefined

  const orchestratorOverride = agentOverrides["atlas"]
  const atlasRequirement = AGENT_MODEL_REQUIREMENTS["atlas"]

  let atlasResolution = applyModelResolution({
    uiSelectedModel: orchestratorOverride?.model !== undefined ? undefined : uiSelectedModel,
    userModel: orchestratorOverride?.model,
    requirement: atlasRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (!atlasResolution && orchestratorOverride?.model) {
    // User explicitly configured a model but resolution failed (e.g., cold cache, no system default).
    // Honor the user's choice directly instead of dropping Atlas entirely.
    atlasResolution = { model: orchestratorOverride.model, provenance: "override" as const }
  }

  if (!atlasResolution) {
    log("[agent-registration] Agent skipped: model resolution returned no result", {
      agent: "atlas",
      configuredModel: orchestratorOverride?.model,
    })
    return undefined
  }
  const { model: atlasModel, variant: atlasResolvedVariant } = atlasResolution

  let orchestratorConfig = createAtlasAgent({
    model: atlasModel,
    availableAgents,
    availableSkills,
    userCategories,
  })

  if (atlasResolvedVariant) {
    orchestratorConfig = { ...orchestratorConfig, variant: atlasResolvedVariant }
  }

  orchestratorConfig = applyOverrides(orchestratorConfig, orchestratorOverride, mergedCategories, directory)

  // The body above is baked from the *configured* model. If the user switches to
  // a different model family in the TUI, the system-transform hook rebuilds the
  // prompt for the runtime model using this captured pipeline (post-override).
  setAtlasRuntimePromptContext({
    configuredModel: orchestratorConfig.model ?? atlasModel,
    bakedPrompt: orchestratorConfig.prompt ?? "",
    rebuildPromptForModel: (runtimeModel: string): string => {
      let rebuilt = createAtlasAgent({
        model: runtimeModel,
        availableAgents,
        availableSkills,
        userCategories,
      })
      rebuilt = applyOverrides(rebuilt, orchestratorOverride, mergedCategories, directory)
      return rebuilt.prompt ?? ""
    },
  })

  return orchestratorConfig
}
