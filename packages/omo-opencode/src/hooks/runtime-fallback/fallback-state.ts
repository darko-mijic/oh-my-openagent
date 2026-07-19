import {
  areRuntimeFallbackModelsEquivalent,
  stringifyRuntimeFallbackModel,
  stringifyRuntimeFallbackModelWithVariant,
} from "@oh-my-opencode/model-core"
import type { FallbackState, FallbackResult } from "./types"
import type { SelectedFallback } from "./types"
import type { FallbackModelObject } from "../../config/schema/fallback-models"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import type { RuntimeFallbackConfig } from "../../config"
import { parseModelString } from "../../shared/model-string-parser"

export const stringifyRuntimeModel = stringifyRuntimeFallbackModel
export const stringifyRuntimeModelWithVariant = stringifyRuntimeFallbackModelWithVariant

export function areRuntimeModelsEquivalent(candidate: string | undefined, current: string | undefined): boolean {
  return areRuntimeFallbackModelsEquivalent(candidate, current)
}

export function createFallbackState(originalModel: unknown): FallbackState {
  const model = stringifyRuntimeModel(originalModel) ?? String(originalModel)

  return {
    originalModel: model,
    currentModel: model,
    fallbackIndex: -1,
    failedModels: new Map<string, number>(),
    attemptCount: 0,
    selectedFallback: undefined,
    pendingFallback: undefined,
    pendingFallbackModel: undefined,
    runtimePromptParamsApplied: false,
    transitionVersion: 0,
  }
}

function normalizeFallbackEntry(entry: string | FallbackModelObject): FallbackModelObject {
  return typeof entry === "string" ? { model: entry } : { ...entry }
}

export function getSelectedFallbackModel(selectedFallback: SelectedFallback): string {
  return stringifyRuntimeModelWithVariant(
    selectedFallback.entry.model,
    selectedFallback.entry.variant,
  ) ?? selectedFallback.entry.model
}

export function getSelectedFallbackProviderModel(selectedFallback: SelectedFallback): string {
  const model = getSelectedFallbackModel(selectedFallback)
  const parsed = parseModelString(model)
  return parsed ? `${parsed.providerID}/${parsed.modelID}` : model
}

export function getFallbackEntryKey(selectedFallback: SelectedFallback): string {
  return `${selectedFallback.selectedIndex}:${getSelectedFallbackModel(selectedFallback)}`
}

export function findFallbackSelection(
  fallbackModels: readonly (string | FallbackModelObject)[],
  model: string,
): SelectedFallback | undefined {
  const selections: SelectedFallback[] = []
  for (let selectedIndex = 0; selectedIndex < fallbackModels.length; selectedIndex++) {
    const candidate = fallbackModels[selectedIndex]
    if (candidate === undefined) continue
    const selectedFallback = {
      selectedIndex,
      entry: normalizeFallbackEntry(candidate),
    }
    selections.push(selectedFallback)
    if (getSelectedFallbackModel(selectedFallback) === model) {
      return selectedFallback
    }
  }
  return selections.find((selection) => getSelectedFallbackProviderModel(selection) === model)
}

function getPrimaryEntryKey(model: string): string {
  return `-1:${model}`
}

export function isModelInCooldown(model: string, state: FallbackState, cooldownSeconds: number): boolean {
  const failedAt = state.failedModels.get(getPrimaryEntryKey(model))
  if (failedAt === undefined) return false
  const cooldownMs = cooldownSeconds * 1000
  return Date.now() - failedAt < cooldownMs
}

export function findNextAvailableFallback(
  state: FallbackState,
  fallbackModels: readonly (string | FallbackModelObject)[],
  cooldownSeconds: number
): SelectedFallback | undefined {
  for (let selectedIndex = state.fallbackIndex + 1; selectedIndex < fallbackModels.length; selectedIndex++) {
    const candidate = fallbackModels[selectedIndex]
    if (candidate === undefined) continue
    const selectedFallback = {
      selectedIndex,
      entry: normalizeFallbackEntry(candidate),
    }
    const candidateModel = getSelectedFallbackModel(selectedFallback)
    if (
      areRuntimeFallbackModelsEquivalent(candidateModel, state.currentModel) &&
      candidateModel !== state.currentModel
    ) {
      log(`[${HOOK_NAME}] Skipping equivalent fallback model`, {
        model: candidateModel,
        currentModel: state.currentModel,
        index: selectedIndex,
      })
      continue
    }

    const failedAt = state.failedModels.get(getFallbackEntryKey(selectedFallback))
    const cooldownMs = cooldownSeconds * 1000
    if (failedAt === undefined || Date.now() - failedAt >= cooldownMs) {
      return selectedFallback
    }
    log(`[${HOOK_NAME}] Skipping fallback model in cooldown`, {
      model: candidateModel,
      index: selectedIndex,
    })
  }
  return undefined
}

export function prepareFallback(
  sessionID: string,
  state: FallbackState,
  fallbackModels: readonly (string | FallbackModelObject)[],
  config: Required<RuntimeFallbackConfig>
): FallbackResult {
  if (state.attemptCount >= config.max_fallback_attempts) {
    log(`[${HOOK_NAME}] Max fallback attempts reached`, { sessionID, attempts: state.attemptCount })
    return { success: false, error: "Max fallback attempts reached", maxAttemptsReached: true }
  }

  const selectedFallback = findNextAvailableFallback(state, fallbackModels, config.cooldown_seconds)

  if (!selectedFallback) {
    log(`[${HOOK_NAME}] No available fallback models`, { sessionID })
    return { success: false, error: "No available fallback models (all in cooldown or exhausted)" }
  }

  const nextModel = getSelectedFallbackModel(selectedFallback)
  log(`[${HOOK_NAME}] Preparing fallback`, {
    sessionID,
    from: state.currentModel,
    to: nextModel,
    attempt: state.attemptCount + 1,
  })

  const failedEntryKey = state.selectedFallback
    ? getFallbackEntryKey(state.selectedFallback)
    : getPrimaryEntryKey(state.currentModel)
  const now = Date.now()

  state.transitionVersion += 1
  state.fallbackIndex = selectedFallback.selectedIndex
  state.failedModels.set(failedEntryKey, now)
  state.attemptCount++
  state.currentModel = nextModel
  state.selectedFallback = selectedFallback
  state.pendingFallback = selectedFallback
  state.pendingFallbackModel = nextModel

  return { success: true, selectedFallback, newModel: nextModel }
}
