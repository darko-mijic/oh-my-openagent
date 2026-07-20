import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname } from "node:path"
import { z } from "zod"
import { writeFileAtomically } from "../../shared/write-file-atomically"
import {
  createFinalWaveReceiptSidecar,
  receiptSidecarPathForPlan,
  type FinalWaveReceipt,
  type FinalWaveReceiptBaseline,
  type FinalWaveReceiptBinding,
  type FinalWaveReceiptFingerprint,
  type FinalWaveReceiptRowContract,
  type FinalWaveReceiptSidecar,
} from "./final-wave-receipt-sidecar-writer"
import { FINAL_WAVE_REVIEWER_ROLES, parseFinalWaveRoles, type FinalWaveRole, type FinalWaveRoleRow } from "./final-wave-role-parser"

const RoleSchema = z.enum(FINAL_WAVE_REVIEWER_ROLES)
const ReceiptStoreSchema = z.object({
  version: z.literal(1),
  baseline: z.object({
    gitHead: z.union([z.string(), z.literal("nogit")]),
    planSha256: z.string(),
    stampedAt: z.string(),
    fRowContract: z.record(z.string(), z.object({ role: RoleSchema, title: z.string(), scope: z.array(z.string()) })),
  }).nullable(),
  expectations: z.record(z.string(), z.object({ role: RoleSchema, subagent: z.string(), launchId: z.string(), createdAt: z.string() })),
  bindings: z.record(z.string(), z.object({ fKey: z.string(), childSessionId: z.string(), boundAt: z.string() })),
  receipts: z.record(z.string(), z.object({
    role: RoleSchema,
    expectedSubagent: z.string(),
    actualAgent: z.string(),
    childSessionId: z.string(),
    launchId: z.string(),
    verdict: z.literal("approve"),
    fingerprint: z.object({ gitHead: z.union([z.string(), z.literal("nogit")]), scopePaths: z.array(z.string()), scopeHash: z.string() }),
    createdAt: z.string(),
  })),
})

export type FinalWaveContractStatus =
  | { readonly kind: "uninitialized" }
  | { readonly kind: "intact"; readonly digestChanged: boolean }
  | { readonly kind: "violation"; readonly violatedFKeys: readonly string[]; readonly recovery: string }

export type FinalWaveReceiptStore = FinalWaveReceiptSidecar
export type FinalWaveReceiptStoreRead = FinalWaveReceiptStore & { readonly contract: FinalWaveContractStatus }
export type ReceiptStoreReadResult = FinalWaveReceiptStoreRead | { readonly corrupt: true }
export type ReceiptRejection = "duplicate" | "late" | "stale" | "mismatched" | "corrupt" | "contract-violation"
export type ReceiptWriteResult = { readonly kind: "written"; readonly store: FinalWaveReceiptStoreRead } | { readonly kind: ReceiptRejection }
export type BindingWriteResult = { readonly kind: "recorded"; readonly store: FinalWaveReceiptStoreRead } | { readonly kind: ReceiptRejection }

export type LaunchExpectationInput = {
  readonly fKey: string
  readonly role: FinalWaveRole
  readonly subagent: string
  readonly launchId: string
  readonly createdAt?: string
}

export type BindingInput = {
  readonly launchId: string
  readonly fKey: string
  readonly childSessionId: string
  readonly boundAt?: string
}

export type ReceiptInput = {
  readonly fKey: string
  readonly launchId: string
  readonly childSessionId: string
  readonly actualAgent: string
  readonly fingerprint: FinalWaveReceiptFingerprint
  readonly createdAt?: string
}

export type ReconstructedFinalWaveState = {
  readonly approvedCount: number
  readonly requiredCount: number
  readonly waitingForApproval: boolean
  readonly contractViolation: boolean
}

export type QuarantineResult = {
  readonly kind: "not-corrupt" | "advisory" | "advisory-recovery" | "blocking-recovery"
  readonly path: string
  readonly message: string
}

export function receiptStorePathForPlan(planPath: string): string {
  return receiptSidecarPathForPlan(planPath)
}

export function planSha256(planContent: string): string {
  return createHash("sha256").update(planContent).digest("hex")
}

export function readReceiptStore(planPath: string): ReceiptStoreReadResult {
  const sidecarPath = receiptStorePathForPlan(planPath)
  if (!existsSync(sidecarPath)) return evaluateContract(createFinalWaveReceiptSidecar({ baseline: null }), planPath)

  let raw: string
  try {
    raw = readFileSync(sidecarPath, "utf-8")
  } catch {
    return { corrupt: true }
  }
  const parsed = parseReceiptStore(raw)
  return parsed === null ? { corrupt: true } : evaluateContract(parsed, planPath)
}

export function writeFinalWaveReceiptStore(planPath: string, store: FinalWaveReceiptStore | FinalWaveReceiptStoreRead): string {
  const sidecarPath = receiptStorePathForPlan(planPath)
  mkdirSync(dirname(sidecarPath), { recursive: true })
  writeFileAtomically(sidecarPath, `${JSON.stringify(persistedStore(store), null, 2)}\n`)
  return sidecarPath
}

export function stampBaseline(planPath: string): ReceiptWriteResult {
  const existing = readReceiptStore(planPath)
  if ("corrupt" in existing) return { kind: "corrupt" }
  if (existing.contract.kind === "violation") return { kind: "contract-violation" }
  if (existing.baseline !== null) return { kind: "written", store: existing }

  const material = readPlanMaterial(planPath)
  const baseline = material?.parsed.status === "marked"
    ? createBaseline(material.content, material.parsed.rows, planPath)
    : null
  const store = { ...persistedStore(existing), baseline }
  writeFinalWaveReceiptStore(planPath, store)
  return { kind: "written", store: evaluateContract(store, planPath) }
}

export function recordLaunchExpectation(planPath: string, input: LaunchExpectationInput): ReceiptWriteResult {
  const stamped = stampBaseline(planPath)
  if (stamped.kind !== "written") return stamped
  if (stamped.store.baseline !== null && !Object.hasOwn(stamped.store.baseline.fRowContract, input.fKey)) {
    return { kind: "mismatched" }
  }

  const store = {
    ...persistedStore(stamped.store),
    expectations: {
      ...stamped.store.expectations,
      [input.fKey]: { role: input.role, subagent: input.subagent, launchId: input.launchId, createdAt: input.createdAt ?? nowIso() },
    },
  }
  writeFinalWaveReceiptStore(planPath, store)
  return { kind: "written", store: evaluateContract(store, planPath) }
}

export function recordBinding(planPath: string, input: BindingInput): BindingWriteResult {
  const result = readReceiptStore(planPath)
  if ("corrupt" in result) return { kind: "corrupt" }
  if (result.contract.kind === "violation") return { kind: "contract-violation" }
  const expectation = result.expectations[input.fKey]
  if (expectation === undefined) return { kind: "late" }
  if (expectation.launchId !== input.launchId) return { kind: "stale" }
  const priorBinding = result.bindings[input.launchId]
  if (priorBinding !== undefined && !isBindingMatch(priorBinding, input)) return { kind: "mismatched" }

  const store = {
    ...persistedStore(result),
    bindings: {
      ...result.bindings,
      [input.launchId]: { fKey: input.fKey, childSessionId: input.childSessionId, boundAt: input.boundAt ?? nowIso() },
    },
  }
  writeFinalWaveReceiptStore(planPath, store)
  return { kind: "recorded", store: evaluateContract(store, planPath) }
}

export function writeReceipt(planPath: string, input: ReceiptInput): ReceiptWriteResult {
  const result = readReceiptStore(planPath)
  if ("corrupt" in result) return { kind: "corrupt" }
  if (result.contract.kind === "violation") return { kind: "contract-violation" }
  if (result.receipts[input.fKey] !== undefined) return { kind: "duplicate" }
  const expectation = result.expectations[input.fKey]
  if (expectation === undefined) return { kind: "late" }
  if (expectation.launchId !== input.launchId) return { kind: "stale" }
  const binding = result.bindings[input.launchId]
  if (input.actualAgent !== expectation.subagent || !matchesReceiptBinding(binding, input)) return { kind: "mismatched" }

  const receipt: FinalWaveReceipt = {
    role: expectation.role,
    expectedSubagent: expectation.subagent,
    actualAgent: input.actualAgent,
    childSessionId: input.childSessionId,
    launchId: input.launchId,
    verdict: "approve",
    fingerprint: input.fingerprint,
    createdAt: input.createdAt ?? nowIso(),
  }
  const store = { ...persistedStore(result), receipts: { ...result.receipts, [input.fKey]: receipt } }
  writeFinalWaveReceiptStore(planPath, store)
  return { kind: "written", store: evaluateContract(store, planPath) }
}

export function revokeReceiptsForFKey(store: FinalWaveReceiptStore | FinalWaveReceiptStoreRead, fKey: string): FinalWaveReceiptStore {
  const receipts = { ...store.receipts }
  delete receipts[fKey]
  return { ...persistedStore(store), receipts }
}

export function reconstructFinalWaveState(input: FinalWaveReceiptStore | ReceiptStoreReadResult): ReconstructedFinalWaveState {
  if ("corrupt" in input) return { approvedCount: 0, requiredCount: 0, waitingForApproval: false, contractViolation: true }
  const requiredFKeys = input.baseline === null ? [] : Object.keys(input.baseline.fRowContract)
  const approvedCount = requiredFKeys.filter((fKey) => input.receipts[fKey] !== undefined).length
  const contractViolation = "contract" in input && input.contract.kind === "violation"
  return {
    approvedCount,
    requiredCount: requiredFKeys.length,
    waitingForApproval: !contractViolation && requiredFKeys.length > 0 && approvedCount === requiredFKeys.length,
    contractViolation,
  }
}

export function quarantineCorruptReceiptStore(planPath: string, timestamp = String(Date.now())): QuarantineResult {
  const sidecarPath = receiptStorePathForPlan(planPath)
  if (!("corrupt" in readReceiptStore(planPath))) {
    return { kind: "not-corrupt", path: sidecarPath, message: "Receipt sidecar is readable." }
  }
  const material = readPlanMaterial(planPath)
  if (material?.parsed.status !== "marked") {
    return { kind: "advisory", path: sidecarPath, message: "Legacy or invalid final-wave plans remain advisory." }
  }

  const recoveryPath = `${sidecarPath.slice(0, -".json".length)}.corrupt-${timestamp}.json`
  renameSync(sidecarPath, recoveryPath)
  const isGitWorkspace = resolveGitHead(planPath) !== "nogit"
  return isGitWorkspace
    ? { kind: "blocking-recovery", path: recoveryPath, message: "Re-stamp the baseline and re-run all affected final-wave reviews." }
    : { kind: "advisory-recovery", path: recoveryPath, message: "Non-git workspaces remain advisory; re-stamp before the next wave." }
}

function parseReceiptStore(raw: string): FinalWaveReceiptStore | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = ReceiptStoreSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function evaluateContract(store: FinalWaveReceiptStore, planPath: string): FinalWaveReceiptStoreRead {
  if (store.baseline === null) return { ...store, contract: { kind: "uninitialized" } }
  const material = readPlanMaterial(planPath)
  const currentRows = material?.parsed.status === "marked" ? material.parsed.rows : []
  const rowsByKey = new Map(currentRows.map((row) => [row.fKey, normalizeRowContract(row)]))
  const violatedFKeys = Object.entries(store.baseline.fRowContract)
    .filter(([fKey, frozen]) => !contractsMatch(frozen, rowsByKey.get(fKey)))
    .map(([fKey]) => fKey)
  if (violatedFKeys.length > 0) {
    const revoked = violatedFKeys.reduce((current, fKey) => revokeReceiptsForFKey(current, fKey), store)
    return { ...revoked, contract: { kind: "violation", violatedFKeys, recovery: "Restore the frozen rows or re-stamp the wave and re-run affected reviews." } }
  }
  const digestChanged = material === null || planSha256(material.content) !== store.baseline.planSha256
  return { ...store, contract: { kind: "intact", digestChanged } }
}

function createBaseline(planContent: string, rows: readonly FinalWaveRoleRow[], planPath: string): FinalWaveReceiptBaseline {
  return {
    gitHead: resolveGitHead(planPath),
    planSha256: planSha256(planContent),
    stampedAt: nowIso(),
    fRowContract: Object.fromEntries(rows.map((row) => [row.fKey, normalizeRowContract(row)])),
  }
}

function normalizeRowContract(row: FinalWaveRoleRow): FinalWaveReceiptRowContract {
  return { role: row.role, title: row.title.replace(/\s+/g, " ").trim(), scope: normalizeScope(row.scope) }
}

function normalizeScope(scope: readonly string[]): readonly string[] {
  return [...new Set(scope.map((path) => path.trim()).filter(Boolean))].sort()
}

function contractsMatch(frozen: FinalWaveReceiptRowContract, current: FinalWaveReceiptRowContract | undefined): boolean {
  return current !== undefined
    && frozen.role === current.role
    && frozen.title.replace(/\s+/g, " ").trim() === current.title
    && normalizeScope(frozen.scope).join("\u0000") === current.scope.join("\u0000")
}

function readPlanMaterial(planPath: string): { readonly content: string; readonly parsed: ReturnType<typeof parseFinalWaveRoles> } | null {
  try {
    const content = readFileSync(planPath, "utf-8")
    return { content, parsed: parseFinalWaveRoles(content) }
  } catch {
    return null
  }
}

export function resolveGitHead(path: string): string | "nogit" {
  const result = spawnSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (result.status === 0 && typeof result.stdout === "string" && result.stdout.trim().length > 0) {
    return result.stdout.trim()
  }
  const fromParent = spawnSync("git", ["-C", dirname(path), "rev-parse", "HEAD"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  return fromParent.status === 0 && typeof fromParent.stdout === "string" && fromParent.stdout.trim().length > 0
    ? fromParent.stdout.trim()
    : "nogit"
}

function matchesReceiptBinding(binding: FinalWaveReceiptBinding | undefined, input: ReceiptInput): boolean {
  return binding !== undefined && binding.fKey === input.fKey && binding.childSessionId === input.childSessionId
}

function isBindingMatch(binding: FinalWaveReceiptBinding, input: BindingInput): boolean {
  return binding.fKey === input.fKey && binding.childSessionId === input.childSessionId
}

function persistedStore(store: FinalWaveReceiptStore | FinalWaveReceiptStoreRead): FinalWaveReceiptStore {
  return { version: 1, baseline: store.baseline, expectations: store.expectations, bindings: store.bindings, receipts: store.receipts }
}

function nowIso(): string {
  return new Date().toISOString()
}
