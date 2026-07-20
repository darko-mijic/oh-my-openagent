import { DEFAULT_CATEGORIES } from "../../tools/delegate-task/constants"

export const FINAL_WAVE_REVIEWER_ROLES = [
  "plan-auditor",
  "code-reviewer",
  "qa-executor",
  "scope-auditor",
] as const

export const FINAL_WAVE_TASK_ROW = /^- \[[ xX~]\] F[1-9]\d*\. .+$/i

export type FinalWaveRole = (typeof FINAL_WAVE_REVIEWER_ROLES)[number]

export type FinalWaveRoleRow = {
  readonly fKey: string
  readonly title: string
  readonly role: FinalWaveRole
  readonly scope: readonly string[]
}

export type FinalWaveRoleContractStatus =
  | "marked"
  | "legacy-unmarked"
  | { readonly invalid: readonly string[] }

export type FinalWaveRoleParseResult = {
  readonly status: FinalWaveRoleContractStatus
  readonly rows: readonly FinalWaveRoleRow[]
}

type MarkdownFence = {
  readonly marker: "`" | "~"
  readonly length: number
}

type RowParseResult =
  | { readonly kind: "marked"; readonly row: FinalWaveRoleRow }
  | { readonly kind: "unmarked" }
  | { readonly kind: "invalid"; readonly reason: string }

const SECTION_BOUNDARY_HEADING = /^#{1,2}(?:[ \t]+|$)/
const FINAL_VERIFICATION_HEADING = /^##\s+Final Verification Wave\b/i
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/
const REVIEWER_ROLE_SET = new Set<string>(FINAL_WAVE_REVIEWER_ROLES)

export function parseFinalWaveRoles(planContent: string): FinalWaveRoleParseResult {
  const rows: FinalWaveRoleRow[] = []
  const invalid: string[] = []
  let fence: MarkdownFence | null = null
  let isFinalVerificationWave = false
  let markedRowCount = 0
  let unmarkedRowCount = 0

  for (const line of planContent.split(/\r?\n/)) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) fence = null
      continue
    }

    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }

    if (SECTION_BOUNDARY_HEADING.test(line)) {
      isFinalVerificationWave = FINAL_VERIFICATION_HEADING.test(line)
      continue
    }

    if (!isFinalVerificationWave || !FINAL_WAVE_TASK_ROW.test(line)) continue

    const parsedRow = parseFinalWaveRow(line)
    switch (parsedRow.kind) {
      case "marked":
        markedRowCount += 1
        rows.push(parsedRow.row)
        break
      case "unmarked":
        unmarkedRowCount += 1
        break
      case "invalid":
        invalid.push(parsedRow.reason)
        break
      default:
        assertNever(parsedRow)
    }
  }

  if (invalid.length > 0) {
    return { status: { invalid }, rows: [] }
  }

  if (markedRowCount === 0) {
    return { status: "legacy-unmarked", rows: [] }
  }

  if (unmarkedRowCount > 0) {
    return {
      status: { invalid: ["mixed marked and unmarked Final Verification Wave rows"] },
      rows: [],
    }
  }

  return { status: "marked", rows }
}

function parseFinalWaveRow(line: string): RowParseResult {
  const commentStart = line.indexOf("<!--")
  if (commentStart === -1) return { kind: "unmarked" }

  const comment = line.match(/\s*<!--([\s\S]*?)-->\s*$/)
  if (comment === null) {
    return { kind: "invalid", reason: "malformed Final Verification Wave role marker" }
  }

  const attributes = comment[1] ?? ""
  const roleValues = Array.from(attributes.matchAll(/\brole\s*:\s*(\S*)/gi), (match) => match[1] ?? "")
  if (roleValues.length === 0) {
    return { kind: "invalid", reason: "malformed Final Verification Wave role marker: missing role" }
  }
  if (roleValues.length > 1) {
    return { kind: "invalid", reason: "duplicate role attribute on Final Verification Wave row" }
  }

  const roleValue = roleValues[0] ?? ""
  if (roleValue.length === 0) {
    return { kind: "invalid", reason: "malformed Final Verification Wave role marker: empty role" }
  }
  if (Object.hasOwn(DEFAULT_CATEGORIES, roleValue)) {
    return { kind: "invalid", reason: `DC-1 category cannot be a reviewer role: ${roleValue}` }
  }
  if (!isFinalWaveReviewerRole(roleValue)) {
    return { kind: "invalid", reason: `unknown role: ${roleValue}` }
  }

  const task = line.slice("- [ ] ".length)
  const separatorIndex = task.indexOf(". ")
  const title = task.slice(separatorIndex + 2, commentStart - "- [ ] ".length).trimEnd()
  const fKey = task.slice(0, separatorIndex).toUpperCase()
  const scope = parseScope(attributes)

  return {
    kind: "marked",
    row: { fKey, title, role: roleValue, scope },
  }
}

function parseScope(attributes: string): readonly string[] {
  const scopeValue = attributes.match(/\bscope\s*:\s*(.*?)(?=\s+[A-Za-z][\w-]*\s*:|$)/i)?.[1]
  if (scopeValue === undefined) return []

  return scopeValue.split(",").map((path) => path.trim()).filter(Boolean)
}

function isFinalWaveReviewerRole(value: string): value is FinalWaveRole {
  return REVIEWER_ROLE_SET.has(value)
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

function assertNever(value: never): never {
  throw new Error(`Unexpected final-wave row parse result: ${String(value)}`)
}
