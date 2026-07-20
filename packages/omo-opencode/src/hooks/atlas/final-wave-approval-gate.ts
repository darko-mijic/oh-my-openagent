import type { SessionState } from "./types"
import {
  countFinalWaveReceiptApprovals,
  resolveFinalWaveEnforcement,
} from "./final-wave-enforcement"
import { readFinalWavePlanState, type FinalWavePlanState } from "./final-wave-plan-state"
import { stampBaseline } from "./final-wave-receipts"
import type { FinalWaveRoleParseResult } from "./final-wave-role-parser"

const ANCHORED_VERDICT_PATTERN = /^VERDICT:\s*(APPROVE|REJECT)\b/i
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/
const BLOCKQUOTE_PATTERN = /^[ \t]*>/

type MarkdownFence = {
  readonly marker: "`" | "~"
  readonly length: number
}

export function stripVerdictContext(output: string): string {
  const kept: string[] = []
  let fence: MarkdownFence | null = null

  for (const line of output.split(/\r?\n/)) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) fence = null
      continue
    }

    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }

    if (BLOCKQUOTE_PATTERN.test(line)) continue
    kept.push(line)
  }

  return kept.join("\n")
}

export function classifyFinalWaveVerdict(output: string): "approve" | "reject" | "missing" {
  let lastVerdict: "approve" | "reject" | undefined

  for (const line of stripVerdictContext(output).split(/\r?\n/)) {
    const match = ANCHORED_VERDICT_PATTERN.exec(line)
    const token = match?.[1]?.toLowerCase()
    if (token === "approve" || token === "reject") {
      lastVerdict = token
    }
  }

  return lastVerdict ?? "missing"
}

function clearFinalWaveApprovalTracking(sessionState: SessionState): void {
  sessionState.pendingFinalWaveTaskCount = undefined
  sessionState.approvedFinalWaveTaskCount = undefined
}

export function shouldPauseForFinalWaveApproval(input: {
  planPath: string
  taskOutput: string
  sessionState: SessionState
  workspaceRoot?: string
}): boolean {
  const planState = readFinalWavePlanState(input.planPath)
  if (!planState) {
    return false
  }

  if (planState.pendingImplementationTaskCount > 0) {
    clearFinalWaveApprovalTracking(input.sessionState)
    return false
  }

  const enforcement = resolveFinalWaveEnforcement(input.planPath, input.workspaceRoot)

  if (enforcement.mode === "blocked") {
    clearFinalWaveApprovalTracking(input.sessionState)
    // Keep the wave paused: release is impossible until recovery.
    return true
  }

  if (enforcement.mode === "enforced") {
    return shouldPauseFromReceipts(input.planPath, input.sessionState, planState.finalWaveRoles)
  }

  return shouldPauseFromCheckboxVerdict(input, planState)
}

function shouldPauseFromReceipts(
  planPath: string,
  sessionState: SessionState,
  finalWaveRoles: FinalWaveRoleParseResult,
): boolean {
  // Ensure a frozen contract exists once the wave is under enforcement.
  if (finalWaveRoles.status === "marked") {
    stampBaseline(planPath)
  }

  const enforcement = resolveFinalWaveEnforcement(planPath)
  if (enforcement.mode !== "enforced") {
    clearFinalWaveApprovalTracking(sessionState)
    return enforcement.mode === "blocked"
  }

  const counts = countFinalWaveReceiptApprovals(enforcement.store)
  let requiredCount = counts.requiredCount
  let approvedCount = counts.approvedCount

  // Empty-valid sidecar before any stamp: require every marked F-row.
  if (requiredCount === 0 && finalWaveRoles.status === "marked") {
    requiredCount = finalWaveRoles.rows.length
    approvedCount = 0
  }

  if (requiredCount === 0) {
    clearFinalWaveApprovalTracking(sessionState)
    return false
  }

  // Checkbox state and bare verdict text never authorize under enforcement.
  const shouldPause = approvedCount >= requiredCount
  if (shouldPause) {
    clearFinalWaveApprovalTracking(sessionState)
  }
  return shouldPause
}

function shouldPauseFromCheckboxVerdict(
  input: {
    planPath: string
    taskOutput: string
    sessionState: SessionState
  },
  planState: FinalWavePlanState,
): boolean {
  if (planState.pendingFinalWaveTaskCount === 0) {
    clearFinalWaveApprovalTracking(input.sessionState)
    return false
  }

  if (classifyFinalWaveVerdict(input.taskOutput) !== "approve") {
    return false
  }

  if (planState.pendingFinalWaveTaskCount === 1) {
    clearFinalWaveApprovalTracking(input.sessionState)
    return true
  }

  if (input.sessionState.pendingFinalWaveTaskCount !== planState.pendingFinalWaveTaskCount) {
    input.sessionState.pendingFinalWaveTaskCount = planState.pendingFinalWaveTaskCount
    input.sessionState.approvedFinalWaveTaskCount = 0
  }

  input.sessionState.approvedFinalWaveTaskCount = (input.sessionState.approvedFinalWaveTaskCount ?? 0) + 1
  const shouldPause = input.sessionState.approvedFinalWaveTaskCount >= planState.pendingFinalWaveTaskCount
  if (shouldPause) {
    clearFinalWaveApprovalTracking(input.sessionState)
  }

  return shouldPause
}

function parseOpeningFence(line: string): MarkdownFence | null {
  const match = line.match(FENCE_PATTERN)
  const run = match?.[1]
  const info = match?.[2]
  const marker = run?.charAt(0)
  if (
    run === undefined
    || info === undefined
    || (marker !== "`" && marker !== "~")
    || (marker === "`" && info.includes("`"))
  ) {
    return null
  }

  return { marker, length: run.length }
}

function isClosingFence(line: string, fence: MarkdownFence): boolean {
  const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1]
  return run?.charAt(0) === fence.marker && run.length >= fence.length
}
