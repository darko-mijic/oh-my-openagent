import type { FallbackState, SelectedFallback } from "./types"
import {
  clearRuntimeFallbackPromptParams,
  getRuntimeFallbackPromptParams,
  setRuntimeFallbackPromptParams,
  type SessionPromptParams,
} from "../../shared/session-prompt-params-state"

type FallbackStateSnapshot = {
  readonly originalModel: string
  readonly currentModel: string
  readonly fallbackIndex: number
  readonly failedModels: Map<string, number>
  readonly attemptCount: number
  readonly selectedFallback: SelectedFallback | undefined
  readonly pendingFallback: SelectedFallback | undefined
  readonly pendingFallbackModel: string | undefined
  readonly pendingFallbackPromptMayHaveBeenAccepted: boolean | undefined
  readonly runtimePromptParamsApplied: boolean
  readonly runtimePromptParams: SessionPromptParams | undefined
  readonly transitionVersion: number
}

export function snapshotFallbackState(
  state: FallbackState,
  sessionID: string,
): FallbackStateSnapshot {
  return {
    originalModel: state.originalModel,
    currentModel: state.currentModel,
    fallbackIndex: state.fallbackIndex,
    failedModels: new Map(state.failedModels),
    attemptCount: state.attemptCount,
    selectedFallback: state.selectedFallback,
    pendingFallback: state.pendingFallback,
    pendingFallbackModel: state.pendingFallbackModel,
    pendingFallbackPromptMayHaveBeenAccepted: state.pendingFallbackPromptMayHaveBeenAccepted,
    runtimePromptParamsApplied: state.runtimePromptParamsApplied,
    runtimePromptParams: getRuntimeFallbackPromptParams(sessionID),
    transitionVersion: state.transitionVersion,
  }
}

export function restoreFallbackState(
  state: FallbackState,
  snapshot: FallbackStateSnapshot,
  sessionID: string,
): boolean {
  if (state.transitionVersion !== snapshot.transitionVersion + 1) return false

  state.originalModel = snapshot.originalModel
  state.currentModel = snapshot.currentModel
  state.fallbackIndex = snapshot.fallbackIndex
  state.failedModels = new Map(snapshot.failedModels)
  state.attemptCount = snapshot.attemptCount
  state.selectedFallback = snapshot.selectedFallback
  state.pendingFallback = snapshot.pendingFallback
  state.pendingFallbackModel = snapshot.pendingFallbackModel
  state.pendingFallbackPromptMayHaveBeenAccepted = snapshot.pendingFallbackPromptMayHaveBeenAccepted
  state.runtimePromptParamsApplied = snapshot.runtimePromptParamsApplied
  state.transitionVersion = snapshot.transitionVersion
  if (snapshot.runtimePromptParams) {
    setRuntimeFallbackPromptParams(sessionID, snapshot.runtimePromptParams)
  } else {
    clearRuntimeFallbackPromptParams(sessionID)
  }
  return true
}
