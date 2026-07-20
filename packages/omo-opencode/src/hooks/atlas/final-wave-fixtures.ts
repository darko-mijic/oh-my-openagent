import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { FinalWaveRole } from "./final-wave-role-parser"
import {
  createFinalWaveReceiptSidecar,
  receiptSidecarPathForPlan,
  writeMalformedFinalWaveReceiptSidecar,
  type FinalWaveReceiptSidecar,
} from "./final-wave-receipt-sidecar-writer"

export const FINAL_WAVE_FIXTURE_VARIANTS = [
  "legacy-unmarked",
  "marked-correct",
  "marked-wrong-category",
  "marked-wrong-agent",
  "corrupt-sidecar",
] as const

export type FinalWaveFixtureVariant = (typeof FINAL_WAVE_FIXTURE_VARIANTS)[number]

export const FINAL_WAVE_FIXTURE_KEYS = ["F1", "F2", "F3", "F4"] as const
export type FinalWaveFixtureKey = (typeof FINAL_WAVE_FIXTURE_KEYS)[number]

export type FinalWaveFixtureRow = {
  readonly fKey: FinalWaveFixtureKey
  readonly title: string
  readonly role: FinalWaveRole
  readonly subagent: "momus" | "oracle" | "qa-executor"
}

export const FINAL_WAVE_FIXTURE_ROWS: Readonly<Record<FinalWaveFixtureKey, FinalWaveFixtureRow>> = {
  F1: { fKey: "F1", title: "Plan compliance audit", role: "plan-auditor", subagent: "momus" },
  F2: { fKey: "F2", title: "Code quality review", role: "code-reviewer", subagent: "oracle" },
  F3: { fKey: "F3", title: "Real manual QA", role: "qa-executor", subagent: "qa-executor" },
  F4: { fKey: "F4", title: "Scope fidelity check", role: "scope-auditor", subagent: "momus" },
}

export type BuildFinalWaveFixturePlanInput = {
  readonly variant: FinalWaveFixtureVariant
  readonly completedFinalWaveKeys?: readonly FinalWaveFixtureKey[]
}

export type WriteFinalWaveFixturePlanInput = BuildFinalWaveFixturePlanInput & {
  readonly workspaceRoot: string
  readonly slug: string
}

export type WrittenFinalWaveFixturePlan = {
  readonly planPath: string
  readonly receiptSidecarPath: string
  readonly content: string
}

export function buildFinalWaveFixturePlan(input: BuildFinalWaveFixturePlanInput): string {
  const completedKeys = new Set(input.completedFinalWaveKeys ?? [])
  const rows = FINAL_WAVE_FIXTURE_KEYS.map((fKey) => {
    const row = FINAL_WAVE_FIXTURE_ROWS[fKey]
    const checkbox = completedKeys.has(fKey) ? "x" : " "
    return `- [${checkbox}] ${row.fKey}. ${row.title}${markerForVariant(input.variant, row)}`
  })

  return [
    "# Final-wave fixture plan",
    "",
    "## TODOs",
    "- [x] 1. Ship implementation",
    "",
    "## Final Verification Wave (MANDATORY - after ALL implementation tasks)",
    ...rows,
    "",
  ].join("\n")
}

export function writeFinalWaveFixturePlan(input: WriteFinalWaveFixturePlanInput): WrittenFinalWaveFixturePlan {
  const planPath = join(input.workspaceRoot, ".omo", "plans", `${input.slug}.md`)
  const content = buildFinalWaveFixturePlan(input)
  mkdirSync(dirname(planPath), { recursive: true })
  writeFileSync(planPath, content)

  const receiptSidecarPath = input.variant === "corrupt-sidecar"
    ? writeMalformedFinalWaveReceiptSidecar(planPath)
    : receiptSidecarPathForPlan(planPath)

  return { planPath, receiptSidecarPath, content }
}

export function createFinalWaveFixtureReceiptSidecar(): FinalWaveReceiptSidecar {
  return createFinalWaveReceiptSidecar({
    baseline: {
      gitHead: "fixture-git-head",
      planSha256: "fixture-plan-sha256",
      stampedAt: "2026-07-20T00:00:00.000Z",
      fRowContract: Object.fromEntries(
        FINAL_WAVE_FIXTURE_KEYS.map((fKey) => {
          const row = FINAL_WAVE_FIXTURE_ROWS[fKey]
          return [row.fKey, { role: row.role, title: row.title, scope: [] }]
        }),
      ),
    },
  })
}

function markerForVariant(variant: FinalWaveFixtureVariant, row: FinalWaveFixtureRow): string {
  switch (variant) {
    case "legacy-unmarked":
      return ""
    case "marked-correct":
    case "marked-wrong-agent":
    case "corrupt-sidecar":
      return ` <!-- role:${row.role} -->`
    case "marked-wrong-category":
      return ` <!-- role:${wrongCategoryFor(row.fKey)} -->`
    default:
      return assertNever(variant)
  }
}

function wrongCategoryFor(fKey: FinalWaveFixtureKey): "unspecified-high" | "deep" | "quick" {
  switch (fKey) {
    case "F1":
      return "unspecified-high"
    case "F2":
      return "deep"
    case "F3":
    case "F4":
      return "quick"
    default:
      return assertNever(fKey)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected final-wave fixture value: ${String(value)}`)
}
