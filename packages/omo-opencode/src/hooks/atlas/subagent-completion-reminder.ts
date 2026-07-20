import type { PluginInput } from "@opencode-ai/plugin"
import { classifyFinalWaveVerdict, shouldPauseForFinalWaveApproval } from "./final-wave-approval-gate"
import {
  hasFinalWaveReceiptForRow,
  resolveFinalWaveEnforcement,
} from "./final-wave-enforcement"
import { readFinalWavePlanState } from "./final-wave-plan-state"
import type { SessionState } from "./types"
import type { TrackedTopLevelTaskRef } from "./types"
import {
  buildAdvanceDirective,
  buildCompletionGate,
  buildFinalWaveApprovalReminder,
  buildMissingVerdictEscalation,
  buildOrchestratorReminder,
  buildRejectedVerdictEscalation,
} from "./verification-reminders"

type CurrentTask = Pick<TrackedTopLevelTaskRef, "key" | "label" | "section"> | null

type ReminderDecision = {
  readonly leadReminder: string
  readonly followupReminder: string | null
  readonly isFinalWaveTask: boolean
  readonly isMissingFinalWaveVerdict: boolean
  readonly isRejectedFinalWaveVerdict: boolean
  readonly isUnverifiedFinalWave: boolean
  readonly shouldPauseForApproval: boolean
}

export async function buildSubagentCompletionReminder(input: {
  readonly ctx: PluginInput
  readonly planPath: string
  readonly planName: string
  readonly progress: { readonly total: number; readonly completed: number }
  readonly preferredSessionId: string
  readonly originalResponse: string
  readonly currentTask: CurrentTask
  readonly sessionState: SessionState | undefined
  readonly isAlreadyVerified: boolean
  readonly autoCommit: boolean
}): Promise<ReminderDecision> {
  const finalWavePlanState = readFinalWavePlanState(input.planPath)
  const isFinalWaveTask = input.currentTask?.section === "final-wave"
    || ((finalWavePlanState?.pendingImplementationTaskCount ?? 1) === 0
      && (finalWavePlanState?.pendingFinalWaveTaskCount ?? 0) > 0)
  const enforcement = resolveFinalWaveEnforcement(input.planPath, input.ctx.directory)
  const isUnverifiedFinalWave = isFinalWaveTask
    && finalWavePlanState?.hasFinalVerificationWave === true
    && finalWavePlanState.finalWaveRoles.status === "legacy-unmarked"
  const finalWaveVerdict = isFinalWaveTask
    ? classifyFinalWaveVerdict(input.originalResponse)
    : "missing"
  const isMissingFinalWaveVerdict = isFinalWaveTask && finalWaveVerdict === "missing"
  const isRejectedFinalWaveVerdict = isFinalWaveTask && finalWaveVerdict === "reject"

  // Under enforcement, checkbox state never authorizes an F-row advance.
  const isAlreadyVerified = resolveIsAlreadyVerified({
    isAlreadyVerified: input.isAlreadyVerified,
    isFinalWaveTask,
    currentTask: input.currentTask,
    planPath: input.planPath,
    workspaceRoot: input.ctx.directory,
    enforcementMode: enforcement.mode,
  })

  const shouldPauseForApproval = input.sessionState
    ? shouldPauseForFinalWaveApproval({
        planPath: input.planPath,
        taskOutput: input.originalResponse,
        sessionState: input.sessionState,
        workspaceRoot: input.ctx.directory,
      })
    : false
  const shouldPause = shouldPauseForApproval
    || isMissingFinalWaveVerdict
    || isRejectedFinalWaveVerdict
    || enforcement.mode === "blocked"

  if (input.sessionState) {
    input.sessionState.waitingForFinalWaveApproval = shouldPause
    if (shouldPause && input.sessionState.pendingRetryTimer) {
      clearTimeout(input.sessionState.pendingRetryTimer)
      input.sessionState.pendingRetryTimer = undefined
    }
  }

  if (enforcement.mode === "blocked") {
    await showFinalWaveToast(input.ctx, "Final wave blocked", enforcement.message)
    return {
      leadReminder: enforcement.message,
      followupReminder: null,
      isFinalWaveTask,
      isMissingFinalWaveVerdict,
      isRejectedFinalWaveVerdict,
      isUnverifiedFinalWave,
      shouldPauseForApproval: true,
    }
  }

  if (isMissingFinalWaveVerdict) {
    await showFinalWaveToast(input.ctx, "Final review incomplete", "A reviewer returned no clear verdict. Boulder paused - confirm or re-run the review.")
    return {
      leadReminder: buildMissingVerdictEscalation(
        input.planName,
        input.currentTask?.label ?? "the final-wave task",
        input.preferredSessionId,
      ),
      followupReminder: null,
      isFinalWaveTask,
      isMissingFinalWaveVerdict,
      isRejectedFinalWaveVerdict,
      isUnverifiedFinalWave,
      shouldPauseForApproval,
    }
  }

  if (isRejectedFinalWaveVerdict) {
    await showFinalWaveToast(input.ctx, "Final review rejected", "A reviewer returned VERDICT: REJECT. Boulder paused - fix or ask the user how to proceed.")
    return {
      leadReminder: buildRejectedVerdictEscalation(
        input.planName,
        input.currentTask?.label ?? "the final-wave task",
        input.preferredSessionId,
      ),
      followupReminder: null,
      isFinalWaveTask,
      isMissingFinalWaveVerdict,
      isRejectedFinalWaveVerdict,
      isUnverifiedFinalWave,
      shouldPauseForApproval,
    }
  }

  if (shouldPauseForApproval) {
    return {
      leadReminder: buildFinalWaveApprovalReminder(input.planName, input.progress, input.preferredSessionId),
      followupReminder: null,
      isFinalWaveTask,
      isMissingFinalWaveVerdict,
      isRejectedFinalWaveVerdict,
      isUnverifiedFinalWave,
      shouldPauseForApproval,
    }
  }

  // Enforced F-rows may advance only with a durable receipt for that row.
  // Checkbox state alone never authorizes; missing receipt re-enters the gate.
  if (isAlreadyVerified && canAdvanceAfterVerified({
    isFinalWaveTask,
    currentTask: input.currentTask,
    planPath: input.planPath,
    workspaceRoot: input.ctx.directory,
    enforcementMode: enforcement.mode,
  })) {
    return {
      leadReminder: buildAdvanceDirective(input.planName),
      followupReminder: null,
      isFinalWaveTask,
      isMissingFinalWaveVerdict,
      isRejectedFinalWaveVerdict,
      isUnverifiedFinalWave,
      shouldPauseForApproval,
    }
  }

  if (input.currentTask && input.sessionState && !isFinalWaveTask) {
    input.sessionState.verifiedTaskKeys ??= new Set<string>()
    input.sessionState.verifiedTaskKeys.add(input.currentTask.key)
  }

  return {
    leadReminder: buildCompletionGate(input.planName, input.preferredSessionId),
    followupReminder: buildOrchestratorReminder(input.planName, input.progress, input.preferredSessionId, input.autoCommit, false),
    isFinalWaveTask,
    isMissingFinalWaveVerdict,
    isRejectedFinalWaveVerdict,
    isUnverifiedFinalWave,
    shouldPauseForApproval,
  }
}

function resolveIsAlreadyVerified(input: {
  readonly isAlreadyVerified: boolean
  readonly isFinalWaveTask: boolean
  readonly currentTask: CurrentTask
  readonly planPath: string
  readonly workspaceRoot: string
  readonly enforcementMode: "enforced" | "advisory" | "blocked"
}): boolean {
  if (!input.isFinalWaveTask || input.currentTask === null) {
    return input.isAlreadyVerified
  }
  if (input.enforcementMode === "blocked") {
    return false
  }
  if (input.enforcementMode === "enforced") {
    return hasFinalWaveReceiptForRow(input.planPath, input.currentTask.label, input.workspaceRoot)
  }
  return input.isAlreadyVerified
}

function canAdvanceAfterVerified(input: {
  readonly isFinalWaveTask: boolean
  readonly currentTask: CurrentTask
  readonly planPath: string
  readonly workspaceRoot: string
  readonly enforcementMode: "enforced" | "advisory" | "blocked"
}): boolean {
  if (!input.isFinalWaveTask || input.currentTask === null) {
    return true
  }
  if (input.enforcementMode === "blocked") {
    return false
  }
  if (input.enforcementMode === "enforced") {
    return hasFinalWaveReceiptForRow(input.planPath, input.currentTask.label, input.workspaceRoot)
  }
  return true
}

async function showFinalWaveToast(ctx: PluginInput, title: string, message: string): Promise<void> {
  await ctx.client.tui
    .showToast({
      body: {
        title,
        message,
        variant: "warning" as const,
        duration: 10000,
      },
    })
    .catch(() => {})
}
