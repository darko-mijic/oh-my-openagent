import { randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import { tolerantFsyncSync } from "../../shared/tolerant-fsync"
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
  readonly dirtyPaths: readonly string[]
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
  readonly receiptArchive: Readonly<Record<string, readonly FinalWaveReceipt[]>>
}

export type CreateFinalWaveReceiptSidecarInput = {
  readonly baseline: FinalWaveReceiptBaseline | null
  readonly expectations?: Readonly<Record<string, FinalWaveReceiptExpectation>>
  readonly bindings?: Readonly<Record<string, FinalWaveReceiptBinding>>
  readonly receipts?: Readonly<Record<string, FinalWaveReceipt>>
  readonly receiptArchive?: Readonly<Record<string, readonly FinalWaveReceipt[]>>
}

export function receiptSidecarPathForPlan(planPath: string): string {
  return planPath.endsWith(".md")
    ? `${planPath.slice(0, -".md".length)}.receipts.json`
    : `${planPath}.receipts.json`
}

export function createFinalWaveReceiptSidecar(
  input: CreateFinalWaveReceiptSidecarInput,
): FinalWaveReceiptSidecar {
  return canonicalizeFinalWaveReceiptSidecar({
    version: 1,
    baseline: input.baseline,
    expectations: input.expectations ?? {},
    bindings: input.bindings ?? {},
    receipts: input.receipts ?? {},
    receiptArchive: input.receiptArchive ?? {},
  })
}

export function createFinalWaveReceiptSidecarTempPath(
  sidecarPath: string,
  pid = process.pid,
  randomSuffix = randomUUID(),
): string {
  return `${sidecarPath}.tmp-${pid}-${randomSuffix}`
}

export function writeFinalWaveReceiptSidecarAtomically(input: {
  readonly planPath: string
  readonly sidecar: FinalWaveReceiptSidecar
}): string {
  const sidecarPath = receiptSidecarPathForPlan(input.planPath)
  const tempPath = createFinalWaveReceiptSidecarTempPath(sidecarPath)
  const sidecar = canonicalizeFinalWaveReceiptSidecar(input.sidecar)
  mkdirSync(dirname(sidecarPath), { recursive: true })
  try {
    writeFileSync(tempPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf-8")
    const descriptor = openSync(tempPath, "r+")
    try {
      tolerantFsyncSync(descriptor, `writeFinalWaveReceiptSidecar:${sidecarPath}`)
    } finally {
      closeSync(descriptor)
    }
    renameSync(tempPath, sidecarPath)
    return sidecarPath
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath)
  }
}

function canonicalizeFinalWaveReceiptSidecar(sidecar: FinalWaveReceiptSidecar): FinalWaveReceiptSidecar {
  const baseline = sidecar.baseline === null
    ? null
    : { ...sidecar.baseline, fRowContract: canonicalizeRecord(sidecar.baseline.fRowContract) }
  const bindings = Object.fromEntries(Object.entries(sidecar.bindings).map(([launchId, binding]) => [
    launchId,
    { ...binding, fKey: binding.fKey.toUpperCase() },
  ]))
  return {
    ...sidecar,
    baseline,
    expectations: canonicalizeRecord(sidecar.expectations),
    bindings,
    receipts: canonicalizeRecord(sidecar.receipts),
    receiptArchive: canonicalizeRecord(sidecar.receiptArchive),
  }
}

function canonicalizeRecord<Value>(record: Readonly<Record<string, Value>>): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.entries(record).map(([fKey, value]) => [fKey.toUpperCase(), value]))
}
