import { dirname } from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"
import type { FinalWaveRole } from "./final-wave-role-parser"

export type FinalWaveReceiptFingerprint = {
  readonly gitHead: string | "nogit"
  readonly scopePaths: readonly string[]
  readonly scopeHash: string
}

export type FinalWaveReceiptRowContract = {
  readonly role: FinalWaveRole
  readonly title: string
  readonly scope: readonly string[]
}

export type FinalWaveReceiptBaseline = {
  readonly gitHead: string | "nogit"
  readonly planSha256: string
  readonly stampedAt: string
  readonly fRowContract: Readonly<Record<string, FinalWaveReceiptRowContract>>
}

export type FinalWaveReceiptExpectation = {
  readonly role: FinalWaveRole
  readonly subagent: string
  readonly launchId: string
  readonly createdAt: string
}

export type FinalWaveReceiptBinding = {
  readonly fKey: string
  readonly childSessionId: string
  readonly boundAt: string
}

export type FinalWaveReceipt = {
  readonly role: FinalWaveRole
  readonly expectedSubagent: string
  readonly actualAgent: string
  readonly childSessionId: string
  readonly launchId: string
  readonly verdict: "approve"
  readonly fingerprint: FinalWaveReceiptFingerprint
  readonly createdAt: string
}

export type FinalWaveReceiptSidecar = {
  readonly version: 1
  readonly baseline: FinalWaveReceiptBaseline | null
  readonly expectations: Readonly<Record<string, FinalWaveReceiptExpectation>>
  readonly bindings: Readonly<Record<string, FinalWaveReceiptBinding>>
  readonly receipts: Readonly<Record<string, FinalWaveReceipt>>
}

export type CreateFinalWaveReceiptSidecarInput = {
  readonly baseline: FinalWaveReceiptBaseline | null
  readonly expectations?: Readonly<Record<string, FinalWaveReceiptExpectation>>
  readonly bindings?: Readonly<Record<string, FinalWaveReceiptBinding>>
  readonly receipts?: Readonly<Record<string, FinalWaveReceipt>>
}

export type WriteFinalWaveReceiptSidecarInput = {
  readonly planPath: string
  readonly sidecar: FinalWaveReceiptSidecar
}

export function receiptSidecarPathForPlan(planPath: string): string {
  return planPath.endsWith(".md")
    ? `${planPath.slice(0, -".md".length)}.receipts.json`
    : `${planPath}.receipts.json`
}

export function createFinalWaveReceiptSidecar(
  input: CreateFinalWaveReceiptSidecarInput,
): FinalWaveReceiptSidecar {
  return {
    version: 1,
    baseline: input.baseline,
    expectations: input.expectations ?? {},
    bindings: input.bindings ?? {},
    receipts: input.receipts ?? {},
  }
}

export function writeFinalWaveReceiptSidecar(input: WriteFinalWaveReceiptSidecarInput): string {
  const sidecarPath = receiptSidecarPathForPlan(input.planPath)
  mkdirSync(dirname(sidecarPath), { recursive: true })
  writeFileSync(sidecarPath, JSON.stringify(input.sidecar, null, 2))
  return sidecarPath
}

export function writeMalformedFinalWaveReceiptSidecar(planPath: string): string {
  const sidecarPath = receiptSidecarPathForPlan(planPath)
  mkdirSync(dirname(sidecarPath), { recursive: true })
  writeFileSync(sidecarPath, '{"version":')
  return sidecarPath
}
