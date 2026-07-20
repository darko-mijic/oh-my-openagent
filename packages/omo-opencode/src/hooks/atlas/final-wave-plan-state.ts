import { existsSync, readFileSync } from "node:fs"
import { FINAL_WAVE_TASK_ROW, parseFinalWaveRoles } from "./final-wave-role-parser"
import type { FinalWaveRoleParseResult } from "./final-wave-role-parser"

const TODO_HEADING_PATTERN = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const SECOND_LEVEL_HEADING_PATTERN = /^##\s+/
const UNCHECKED_CHECKBOX_PATTERN = /^\s*[-*]\s*\[\s*\]\s*(.+)$/
const TODO_TASK_PATTERN = /^\d+\./
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/

type PlanSection = "todo" | "final-wave" | "other"

export type FinalWavePlanState = {
  hasFinalVerificationWave: boolean
  pendingImplementationTaskCount: number
  pendingFinalWaveTaskCount: number
  finalWaveRoles: FinalWaveRoleParseResult
}

type MarkdownFence = {
  readonly marker: "`" | "~"
  readonly length: number
}

export function readFinalWavePlanState(planPath: string): FinalWavePlanState | null {
  if (!existsSync(planPath)) {
    return null
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    const lines = content.split(/\r?\n/)
    let section: PlanSection = "other"
    let fence: MarkdownFence | null = null
    let hasFinalVerificationWave = false
    let pendingImplementationTaskCount = 0
    let pendingFinalWaveTaskCount = 0

    for (const line of lines) {
      if (fence !== null) {
        if (isClosingFence(line, fence)) fence = null
        continue
      }

      const openingFence = parseOpeningFence(line)
      if (openingFence !== null) {
        fence = openingFence
        continue
      }

      if (SECOND_LEVEL_HEADING_PATTERN.test(line)) {
        section = TODO_HEADING_PATTERN.test(line)
          ? "todo"
          : FINAL_VERIFICATION_HEADING_PATTERN.test(line)
            ? "final-wave"
            : "other"
        hasFinalVerificationWave ||= section === "final-wave"
      }

      if (section === "final-wave") {
        if (line.startsWith("- [ ] ") && FINAL_WAVE_TASK_ROW.test(line)) {
          pendingFinalWaveTaskCount += 1
        }
        continue
      }

      const uncheckedTaskMatch = line.match(UNCHECKED_CHECKBOX_PATTERN)
      if (!uncheckedTaskMatch) {
        continue
      }

      const taskLabel = uncheckedTaskMatch[1].trim()
      if (section === "todo" && TODO_TASK_PATTERN.test(taskLabel)) {
        pendingImplementationTaskCount += 1
      }
    }

    return {
      hasFinalVerificationWave,
      pendingImplementationTaskCount,
      pendingFinalWaveTaskCount,
      finalWaveRoles: parseFinalWaveRoles(content),
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return null
  }
}

function parseOpeningFence(line: string): MarkdownFence | null {
  const match = line.match(FENCE_PATTERN)
  const run = match?.[1]
  const info = match?.[2]
  const marker = run?.charAt(0)
  if (
    run === undefined ||
    info === undefined ||
    (marker !== "`" && marker !== "~") ||
    (marker === "`" && info.includes("`"))
  ) {
    return null
  }

  return { marker, length: run.length }
}

function isClosingFence(line: string, fence: MarkdownFence): boolean {
  const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1]
  return run?.charAt(0) === fence.marker && run.length >= fence.length
}
