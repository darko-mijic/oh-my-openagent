import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  receiptSidecarPathForPlan,
  type FinalWaveReceiptSidecar,
} from "./final-wave-receipt-sidecar-writer"

export function writeFinalWaveReceiptSidecar(input: {
  readonly planPath: string
  readonly sidecar: FinalWaveReceiptSidecar
}): string {
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
