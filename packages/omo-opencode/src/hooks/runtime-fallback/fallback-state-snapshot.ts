import type { FallbackState, SelectedFallback } from "./types"

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
}

export function snapshotFallbackState(state: FallbackState): FallbackStateSnapshot {
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
  }
}

export function restoreFallbackState(state: FallbackState, snapshot: FallbackStateSnapshot): void {
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
}
