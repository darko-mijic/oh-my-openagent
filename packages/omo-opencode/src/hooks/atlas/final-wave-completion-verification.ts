import type { BoulderState, TaskSessionState } from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { classifyFinalWaveVerdict } from "./final-wave-approval-gate"
import {
  attestCanonicalTreeClean,
  type FinalWaveGitSpawn,
} from "./final-wave-canonical-attestation"
import { computeRowFingerprint } from "./final-wave-fingerprint"
import { readFinalWavePlanState } from "./final-wave-plan-state"
import {
  readReceiptStore,
  recordBinding,
  writeReceipt,
  type BindingWriteResult,
  type ReceiptWriteResult,
} from "./final-wave-receipts"
import { HOOK_NAME } from "./hook-name"
import {
  buildFinalWaveCompletionAdvisory,
  type FinalWaveCompletionAdvisoryReason,
} from "./system-reminder-templates"
import { normalizeTrackedTopLevelTaskRef, type PendingTaskRef, type TrackedTopLevelTaskRef } from "./types"

export type FinalWaveCompletionProcessResult = {
  readonly receiptWritten: boolean
  readonly advisoryText: string | null
  readonly reason: FinalWaveCompletionAdvisoryReason | "written" | "not-final-wave" | "not-approve"
}

export type FinalWaveBindingTarget = {
  readonly launchId: string
  readonly fKey: string
  readonly childSessionId: string
}

export function resolveFinalWaveActualAgent(input: {
  readonly metadata: Record<string, unknown>
  readonly taskSessions?: Record<string, TaskSessionState> | undefined
  readonly taskKey?: string | undefined
}): string | undefined {
  const metadataAgent = input.metadata.agent
  if (typeof metadataAgent === "string" && metadataAgent.length > 0) {
    return metadataAgent
  }

  if (input.taskKey === undefined) return undefined
  const sessionAgent = input.taskSessions?.[input.taskKey]?.agent
  return typeof sessionAgent === "string" && sessionAgent.length > 0 ? sessionAgent : undefined
}

export function resolveFinalWaveBindingTarget(input: {
  readonly planPath: string
  readonly pendingTaskRef: PendingTaskRef | undefined
  readonly childSessionId: string | undefined
}): FinalWaveBindingTarget | null {
  const fromPending = bindingFromPendingRef(input.pendingTaskRef, input.childSessionId)
  if (fromPending !== null) return fromPending

  if (input.childSessionId === undefined || input.childSessionId.length === 0) {
    return null
  }

  const store = readReceiptStore(input.planPath)
  if ("corrupt" in store) return null

  for (const [launchId, binding] of Object.entries(store.bindings)) {
    if (binding.childSessionId === input.childSessionId) {
      return {
        launchId,
        fKey: binding.fKey,
        childSessionId: binding.childSessionId,
      }
    }
  }

  return null
}

export function recordFinalWaveLaunchBinding(input: {
  readonly planPath: string
  readonly task: TrackedTopLevelTaskRef | null | undefined
  readonly childSessionId: string | undefined
}): BindingWriteResult | null {
  if (input.task === null || input.task === undefined) return null
  if (input.childSessionId === undefined || input.childSessionId.length === 0) return null

  const normalized = normalizeTrackedTopLevelTaskRef(input.task)
  if (normalized.section !== "final-wave") return null
  if (normalized.launchId === undefined || normalized.launchId.length === 0) return null

  return recordBinding(input.planPath, {
    launchId: normalized.launchId,
    fKey: normalized.label,
    childSessionId: input.childSessionId,
  })
}

export function processFinalWaveAdvisoryCompletion(input: {
  readonly planPath: string
  readonly workspaceRoot: string
  readonly toolOutput: { readonly output: string; readonly metadata: Record<string, unknown> }
  readonly pendingTaskRef: PendingTaskRef | undefined
  readonly childSessionId: string | undefined
  readonly boulderState: BoulderState
  readonly spawnGit?: FinalWaveGitSpawn
}): FinalWaveCompletionProcessResult {
  const planState = readFinalWavePlanState(input.planPath)
  if (planState?.finalWaveRoles.status !== "marked") {
    return { receiptWritten: false, advisoryText: null, reason: "not-final-wave" }
  }

  if (classifyFinalWaveVerdict(input.toolOutput.output) !== "approve") {
    return { receiptWritten: false, advisoryText: null, reason: "not-approve" }
  }

  const binding = resolveFinalWaveBindingTarget({
    planPath: input.planPath,
    pendingTaskRef: input.pendingTaskRef,
    childSessionId: input.childSessionId,
  })
  if (binding === null) {
    return advisoryResult("missing-binding")
  }

  const bindingWrite = recordBinding(input.planPath, binding)
  if (bindingWrite.kind === "mismatched" || bindingWrite.kind === "stale" || bindingWrite.kind === "late") {
    return advisoryResult("missing-binding", binding.fKey)
  }

  const taskKey = `final-wave:${binding.fKey}`
  const actualAgent = resolveFinalWaveActualAgent({
    metadata: input.toolOutput.metadata,
    taskSessions: input.boulderState.task_sessions,
    taskKey,
  })
  if (actualAgent === undefined) {
    return advisoryResult("missing-identity", binding.fKey)
  }

  const store = readReceiptStore(input.planPath)
  if ("corrupt" in store || store.baseline === null) {
    return advisoryResult("missing-binding", binding.fKey)
  }

  const expectation = store.expectations[binding.fKey]
  if (expectation === undefined) {
    return advisoryResult("missing-binding", binding.fKey)
  }
  if (expectation.subagent !== actualAgent) {
    return advisoryResult("identity-mismatch", binding.fKey, {
      expectedSubagent: expectation.subagent,
      actualAgent,
    })
  }

  const attestation = attestCanonicalTreeClean({
    workspaceRoot: input.workspaceRoot,
    planPath: input.planPath,
    baselineGitHead: store.baseline.gitHead,
    spawnGit: input.spawnGit,
  })
  if (!attestation.ok) {
    log(`[${HOOK_NAME}] Final-wave receipt blocked by dirty canonical tree`, {
      planPath: input.planPath,
      fKey: binding.fKey,
      dirtyPaths: attestation.dirtyPaths,
    })
    return advisoryResult("dirty-workspace", binding.fKey, { dirtyPaths: attestation.dirtyPaths })
  }

  const row = planState.finalWaveRoles.rows.find((candidate) => candidate.fKey === binding.fKey)
  if (row === undefined) {
    return advisoryResult("missing-binding", binding.fKey)
  }

  const fingerprint = computeRowFingerprint({
    planPath: input.planPath,
    row,
    workspaceRoot: input.workspaceRoot,
    baseline: { gitHead: store.baseline.gitHead },
    spawnGit: input.spawnGit,
  })

  const writeResult: ReceiptWriteResult = writeReceipt(input.planPath, {
    fKey: binding.fKey,
    launchId: binding.launchId,
    childSessionId: binding.childSessionId,
    actualAgent,
    fingerprint,
  })

  if (writeResult.kind !== "written") {
    log(`[${HOOK_NAME}] Final-wave receipt write rejected`, {
      planPath: input.planPath,
      fKey: binding.fKey,
      result: writeResult.kind,
    })
    if (writeResult.kind === "mismatched") {
      return advisoryResult("identity-mismatch", binding.fKey, {
        expectedSubagent: expectation.subagent,
        actualAgent,
      })
    }
    return { receiptWritten: false, advisoryText: null, reason: "not-approve" }
  }

  log(`[${HOOK_NAME}] Final-wave advisory receipt written`, {
    planPath: input.planPath,
    fKey: binding.fKey,
    actualAgent,
    launchId: binding.launchId,
  })
  return { receiptWritten: true, advisoryText: null, reason: "written" }
}

function advisoryResult(
  reason: FinalWaveCompletionAdvisoryReason,
  fKey?: string,
  details?: {
    readonly expectedSubagent?: string
    readonly actualAgent?: string
    readonly dirtyPaths?: readonly string[]
  },
): FinalWaveCompletionProcessResult {
  log(`[${HOOK_NAME}] Final-wave advisory completion note`, { reason, fKey, ...details })
  return {
    receiptWritten: false,
    advisoryText: buildFinalWaveCompletionAdvisory({ reason, fKey, ...details }),
    reason,
  }
}

function bindingFromPendingRef(
  pendingTaskRef: PendingTaskRef | undefined,
  childSessionId: string | undefined,
): FinalWaveBindingTarget | null {
  if (pendingTaskRef?.kind !== "track") return null
  if (childSessionId === undefined || childSessionId.length === 0) return null

  const task = normalizeTrackedTopLevelTaskRef(pendingTaskRef.task)
  if (task.section !== "final-wave") return null
  if (task.launchId === undefined || task.launchId.length === 0) return null

  return {
    launchId: task.launchId,
    fKey: task.label,
    childSessionId,
  }
}
