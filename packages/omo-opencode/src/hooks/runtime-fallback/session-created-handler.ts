import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { log } from "../../shared/logger"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { HOOK_NAME } from "./constants"
import {
  createFallbackState,
  findFallbackSelection,
} from "./fallback-state"
import { getRawFallbackModels } from "./fallback-models"
import { normalizeModelToCanonicalString } from "./normalize-model"
import type { HookDeps } from "./types"

function isRuntimeFallbackRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function resolvePreferredSessionModel(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: HookDeps["pluginConfig"],
): string | undefined {
  const agentConfig = agent && pluginConfig?.agents
    ? pluginConfig.agents[agent]
    : undefined
  if (typeof agentConfig?.model === "string") return agentConfig.model

  const category = typeof agentConfig?.category === "string"
    ? agentConfig.category
    : SessionCategoryRegistry.get(sessionID)
  const categoryModel = category ? pluginConfig?.categories?.[category]?.model : undefined
  return typeof categoryModel === "string" ? categoryModel : undefined
}

export function createSessionCreatedHandler(deps: HookDeps) {
  return (props: Record<string, unknown> | undefined): void => {
    const sessionInfo = props?.info
    const sessionRecord = isRuntimeFallbackRecord(sessionInfo) ? sessionInfo : undefined
    const sessionID = resolveSessionEventID(props)
    const model = normalizeModelToCanonicalString(sessionRecord?.model)
    const agent = typeof sessionRecord?.agent === "string"
      ? sessionRecord.agent
      : typeof props?.agent === "string"
        ? props.agent
        : undefined
    if (!sessionID || !model) return

    log(`[${HOOK_NAME}] Session created with model`, { sessionID, model })
    const preferredModel = resolvePreferredSessionModel(sessionID, agent, deps.pluginConfig)
    const selectedFallback = preferredModel && preferredModel !== model
      ? findFallbackSelection(getRawFallbackModels(sessionID, agent, deps.pluginConfig) ?? [], model)
      : undefined
    const state = createFallbackState(selectedFallback && preferredModel ? preferredModel : model)
    if (selectedFallback) {
      state.currentModel = model
      state.fallbackIndex = selectedFallback.selectedIndex
      state.selectedFallback = selectedFallback
    }
    deps.sessionStates.set(sessionID, state)
    deps.sessionLastAccess.set(sessionID, Date.now())
  }
}
