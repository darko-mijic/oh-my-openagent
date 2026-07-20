import { readFinalWavePlanState } from "./final-wave-plan-state"
import {
  quarantineCorruptReceiptStore,
  readReceiptStore,
  reconstructFinalWaveState,
  resolveGitHead,
  type FinalWaveReceiptStoreRead,
  type ReceiptStoreReadResult,
  type ReconstructedFinalWaveState,
} from "./final-wave-receipts"
import type { SessionState } from "./types"

export type FinalWaveEnforcementMode = "enforced" | "advisory" | "blocked"

export type FinalWaveEnforcement =
  | {
      readonly mode: "enforced"
      readonly reason: string
      readonly store: FinalWaveReceiptStoreRead
    }
  | {
      readonly mode: "advisory"
      readonly reason: string
      readonly store?: FinalWaveReceiptStoreRead
    }
  | {
      readonly mode: "blocked"
      readonly reason: string
      readonly message: string
      readonly recovery?: string
      readonly store?: FinalWaveReceiptStoreRead
    }

export function resolveFinalWaveEnforcement(
  planPath: string,
  workspaceRoot?: string,
): FinalWaveEnforcement {
  const planState = readFinalWavePlanState(planPath)
  if (planState === null) {
    return { mode: "advisory", reason: "plan-unreadable" }
  }

  const roles = planState.finalWaveRoles
  if (roles.status !== "marked") {
    return {
      mode: "advisory",
      reason: roles.status === "legacy-unmarked" ? "legacy-unmarked" : "mixed-or-invalid",
    }
  }

  const gitHead = resolveGitHead(workspaceRoot ?? planPath)
  const storeResult = readReceiptStore(planPath)

  if ("corrupt" in storeResult) {
    if (gitHead === "nogit") {
      return { mode: "advisory", reason: "corrupt-sidecar-non-git" }
    }
    const recovery = quarantineCorruptReceiptStore(planPath)
    return {
      mode: "blocked",
      reason: "corrupt-sidecar",
      message: [
        "FINAL WAVE BLOCKED: receipt sidecar is corrupt on a marked git plan.",
        "Release is impossible until recovery completes.",
        recovery.message,
        recovery.path !== "" ? `Quarantine path: ${recovery.path}` : "",
        "Re-stamp the baseline and re-run all affected final-wave reviews.",
      ].filter(Boolean).join(" "),
      recovery: recovery.path,
    }
  }

  if (storeResult.contract.kind === "violation") {
    if (gitHead === "nogit" || storeResult.baseline?.gitHead === "nogit") {
      return {
        mode: "advisory",
        reason: "contract-violation-non-git",
        store: storeResult,
      }
    }
    return {
      mode: "blocked",
      reason: "contract-violation",
      message: [
        "FINAL WAVE BLOCKED: frozen F-row contract was violated after wave init.",
        `Violated rows: ${storeResult.contract.violatedFKeys.join(", ")}.`,
        storeResult.contract.recovery,
      ].join(" "),
      recovery: storeResult.contract.recovery,
      store: storeResult,
    }
  }

  const baselineGitHead = storeResult.baseline?.gitHead
  const effectiveGitHead = baselineGitHead ?? gitHead
  if (effectiveGitHead === "nogit") {
    return {
      mode: "advisory",
      reason: "non-git-workspace",
      store: storeResult,
    }
  }

  return {
    mode: "enforced",
    reason: storeResult.baseline === null ? "marked-git-empty-sidecar" : "marked-git-verifiable",
    store: storeResult,
  }
}

export function countFinalWaveReceiptApprovals(
  store: FinalWaveReceiptStoreRead | ReceiptStoreReadResult | undefined,
): { readonly approvedCount: number; readonly requiredCount: number; readonly contractViolation: boolean } {
  if (store === undefined || "corrupt" in store) {
    return { approvedCount: 0, requiredCount: 0, contractViolation: store !== undefined && "corrupt" in store }
  }
  const reconstructed = reconstructFinalWaveState(store)
  return {
    approvedCount: reconstructed.approvedCount,
    requiredCount: reconstructed.requiredCount,
    contractViolation: reconstructed.contractViolation,
  }
}

export function hasFinalWaveReceiptForRow(planPath: string, fKey: string): boolean {
  const store = readReceiptStore(planPath)
  if ("corrupt" in store) return false
  return store.receipts[fKey.toUpperCase()] !== undefined
    || store.receipts[fKey] !== undefined
}

export function hasAllFinalWaveReceipts(planPath: string, workspaceRoot?: string): boolean {
  const enforcement = resolveFinalWaveEnforcement(planPath, workspaceRoot)
  if (enforcement.mode === "blocked") return false
  if (enforcement.mode !== "enforced") return true

  const counts = resolveEnforcedReceiptCounts(planPath, enforcement.store)
  return counts.requiredCount > 0 && counts.approvedCount >= counts.requiredCount
}

/**
 * Rebuild final-wave GATE state from the durable receipt sidecar after
 * compaction/restart. Todo-list state stays with compaction-todo-preserver;
 * this only owns the pause flag + receipt counters.
 *
 * Pause semantics match reconstructFinalWaveState.waitingForApproval:
 * enforced plans pause only when every required receipt exists (user approval).
 * Blocked plans always pause. Mid-wave (approved < required) does not pause.
 */
export function reconstructFinalWavePauseState(
  sessionState: SessionState,
  planPath: string,
  workspaceRoot?: string,
): ReconstructedFinalWaveState {
  const enforcement = resolveFinalWaveEnforcement(planPath, workspaceRoot)

  if (enforcement.mode === "advisory") {
    return {
      approvedCount: 0,
      requiredCount: 0,
      waitingForApproval: false,
      contractViolation: false,
    }
  }

  if (enforcement.mode === "blocked") {
    sessionState.waitingForFinalWaveApproval = true
    sessionState.pendingFinalWaveTaskCount = undefined
    sessionState.approvedFinalWaveTaskCount = undefined
    return {
      approvedCount: 0,
      requiredCount: 0,
      waitingForApproval: true,
      contractViolation: true,
    }
  }

  const counts = resolveEnforcedReceiptCounts(planPath, enforcement.store)
  sessionState.pendingFinalWaveTaskCount = counts.requiredCount > 0 ? counts.requiredCount : undefined
  sessionState.approvedFinalWaveTaskCount = counts.requiredCount > 0 ? counts.approvedCount : undefined

  const waitingForApproval = counts.requiredCount > 0 && counts.approvedCount >= counts.requiredCount
  if (waitingForApproval) {
    sessionState.waitingForFinalWaveApproval = true
  }

  return {
    approvedCount: counts.approvedCount,
    requiredCount: counts.requiredCount,
    waitingForApproval,
    contractViolation: counts.contractViolation,
  }
}

function resolveEnforcedReceiptCounts(
  planPath: string,
  store: FinalWaveReceiptStoreRead,
): {
  readonly approvedCount: number
  readonly requiredCount: number
  readonly contractViolation: boolean
} {
  const counts = countFinalWaveReceiptApprovals(store)
  if (counts.requiredCount > 0) return counts

  const planState = readFinalWavePlanState(planPath)
  if (planState?.finalWaveRoles.status === "marked") {
    return {
      approvedCount: 0,
      requiredCount: planState.finalWaveRoles.rows.length,
      contractViolation: false,
    }
  }
  return counts
}
