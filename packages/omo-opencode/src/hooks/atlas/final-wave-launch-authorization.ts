import { randomUUID } from "node:crypto"
import { log } from "../../shared/logger"
import { resolveFinalWaveEnforcement } from "./final-wave-enforcement"
import { HOOK_NAME } from "./hook-name"
import { readFinalWavePlanState } from "./final-wave-plan-state"
import { recordLaunchExpectation } from "./final-wave-receipts"
import { resolveFinalWaveBoundSubagent } from "./final-wave-roles"
import {
  buildFinalWaveNamedReviewerAdvisory,
  buildFinalWaveNamedReviewerRejection,
} from "./system-reminder-templates"
import type { TrackedTopLevelTaskRef } from "./types"

export type AuthorizeMarkedFinalWaveLaunchResult =
  | {
      readonly kind: "authorized"
      readonly task: TrackedTopLevelTaskRef & { readonly section: "todo" | "final-wave" }
    }
  | {
      readonly kind: "passthrough"
      readonly task: TrackedTopLevelTaskRef & { readonly section: "todo" | "final-wave" }
    }
  | {
      readonly kind: "rejected"
      readonly message: string
    }

export function authorizeMarkedFinalWaveLaunch(input: {
  readonly planPath: string
  readonly trackedTask: TrackedTopLevelTaskRef & { readonly section: "todo" | "final-wave" }
  readonly args: Record<string, unknown>
  readonly toolOutput: { args: Record<string, unknown>; message?: string }
  readonly sessionID: string | undefined
  readonly callID: string
  readonly workspaceRoot?: string
}): AuthorizeMarkedFinalWaveLaunchResult {
  const planState = readFinalWavePlanState(input.planPath)
  if (planState?.finalWaveRoles.status !== "marked") {
    return { kind: "passthrough", task: input.trackedTask }
  }

  const roleRow = planState.finalWaveRoles.rows.find(
    (row) => row.fKey.toUpperCase() === input.trackedTask.label.toUpperCase(),
  )
  if (roleRow === undefined) {
    return { kind: "passthrough", task: input.trackedTask }
  }

  const enforcement = resolveFinalWaveEnforcement(input.planPath, input.workspaceRoot)
  if (enforcement.mode === "blocked") {
    const message = `\n${enforcement.message}\n`
    input.toolOutput.message = (input.toolOutput.message || "") + message
    log(`[${HOOK_NAME}] Blocked final-wave launch`, {
      sessionID: input.sessionID,
      callID: input.callID,
      fKey: roleRow.fKey,
      reason: enforcement.reason,
    })
    return { kind: "rejected", message: enforcement.message }
  }

  const expectedSubagent = resolveFinalWaveBoundSubagent(roleRow.role)
  const route = classifyFinalWaveRoute(input.args, expectedSubagent)

  if (route.kind === "mismatch") {
    if (enforcement.mode === "enforced") {
      const message = buildFinalWaveNamedReviewerRejection({
        fKey: roleRow.fKey,
        role: roleRow.role,
        expectedSubagent,
        reason: route.reason,
        requestedSubagent: route.requestedSubagent,
        requestedCategory: route.requestedCategory,
      })
      input.toolOutput.message = (input.toolOutput.message || "") + message
      log(`[${HOOK_NAME}] Rejected final-wave named-reviewer mismatch`, {
        sessionID: input.sessionID,
        callID: input.callID,
        fKey: roleRow.fKey,
        role: roleRow.role,
        expectedSubagent,
        reason: route.reason,
      })
      return { kind: "rejected", message: message.trim() }
    }

    input.toolOutput.message = (input.toolOutput.message || "") + buildFinalWaveNamedReviewerAdvisory({
      fKey: roleRow.fKey,
      role: roleRow.role,
      expectedSubagent,
      reason: route.reason,
      requestedSubagent: route.requestedSubagent,
      requestedCategory: route.requestedCategory,
    })
    log(`[${HOOK_NAME}] Advisory final-wave named-reviewer mismatch`, {
      sessionID: input.sessionID,
      callID: input.callID,
      fKey: roleRow.fKey,
      role: roleRow.role,
      expectedSubagent,
      reason: route.reason,
    })
  }

  const launchId = randomUUID()
  const writeResult = recordLaunchExpectation(input.planPath, {
    fKey: roleRow.fKey,
    role: roleRow.role,
    subagent: expectedSubagent,
    launchId,
  })
  if (writeResult.kind !== "written") {
    log(`[${HOOK_NAME}] Failed to persist final-wave launch expectation`, {
      sessionID: input.sessionID,
      callID: input.callID,
      fKey: roleRow.fKey,
      result: writeResult.kind,
    })
  }

  return {
    kind: "authorized",
    task: {
      ...input.trackedTask,
      expectedRole: roleRow.role,
      expectedSubagent,
      launchId,
    },
  }
}

type FinalWaveRouteClassification =
  | { readonly kind: "match" }
  | {
      readonly kind: "mismatch"
      readonly reason: "category" | "wrong-subagent" | "missing-subagent"
      readonly requestedSubagent?: string
      readonly requestedCategory?: string
    }

export function classifyFinalWaveRoute(
  args: Record<string, unknown>,
  expectedSubagent: string,
): FinalWaveRouteClassification {
  const requestedCategory = typeof args.category === "string" ? args.category : undefined
  if (requestedCategory !== undefined && requestedCategory.length > 0) {
    return {
      kind: "mismatch",
      reason: "category",
      requestedCategory,
      requestedSubagent: typeof args.subagent_type === "string" ? args.subagent_type : undefined,
    }
  }

  const requestedSubagent = typeof args.subagent_type === "string" ? args.subagent_type : undefined
  if (requestedSubagent === undefined || requestedSubagent.length === 0) {
    return { kind: "mismatch", reason: "missing-subagent" }
  }
  if (requestedSubagent !== expectedSubagent) {
    return { kind: "mismatch", reason: "wrong-subagent", requestedSubagent }
  }
  return { kind: "match" }
}
