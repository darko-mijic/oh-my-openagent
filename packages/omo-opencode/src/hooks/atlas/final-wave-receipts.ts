import { createHash } from "node:crypto"
import { existsSync, readFileSync, renameSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname } from "node:path"
import { z } from "zod"
import { writeFileAtomically } from "../../shared/write-file-atomically"
import { snapshotCanonicalDirtyPaths } from "./final-wave-canonical-attestation"
import { isReceiptValid } from "./final-wave-fingerprint"
import {
  createFinalWaveReceiptSidecar,
  receiptSidecarPathForPlan,
  writeFinalWaveReceiptSidecarAtomically,
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
    dirtyPaths: z.array(z.string()).default([]),
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
  receiptArchive: z.record(z.string(), z.array(z.object({
    role: RoleSchema,
    expectedSubagent: z.string(),
    actualAgent: z.string(),
    childSessionId: z.string(),
    launchId: z.string(),
    verdict: z.literal("approve"),
    fingerprint: z.object({ gitHead: z.union([z.string(), z.literal("nogit")]), scopePaths: z.array(z.string()), scopeHash: z.string() }),
    createdAt: z.string(),
  }))).default({}),
})

const QuarantineMarkerSchema = z.object({
  version: z.literal(1),
  quarantinedPath: z.string(),
  quarantinedAt: z.string(),
})

const FINAL_WAVE_CHECKBOX_PATTERN = /^- \[[ xX~]\](?= F[1-9]\d*\. )/gim

export type FinalWaveContractStatus =
  | { readonly kind: "uninitialized" }
  | { readonly kind: "intact"; readonly digestChanged: boolean }
  | { readonly kind: "violation"; readonly violatedFKeys: readonly string[]; readonly recovery: string }

export type FinalWaveReceiptStore = FinalWaveReceiptSidecar
export type FinalWaveReceiptStoreRead = FinalWaveReceiptStore & { readonly contract: FinalWaveContractStatus }
export type ReceiptStoreReadResult = FinalWaveReceiptStoreRead | { readonly corrupt: true }
export type ReceiptRejection = "duplicate" | "late" | "stale" | "mismatched" | "corrupt" | "contract-violation" | "quarantined"
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

export type ReceiptQuarantineMarker = z.infer<typeof QuarantineMarkerSchema>
export type ReceiptQuarantineMarkerRead = ReceiptQuarantineMarker | { readonly corrupt: true }

export function receiptStorePathForPlan(planPath: string): string {
  return receiptSidecarPathForPlan(planPath)
}

export function planSha256(planContent: string): string {
  return createHash("sha256").update(planContent.replace(FINAL_WAVE_CHECKBOX_PATTERN, "- [ ]")).digest("hex")
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
  return writeFinalWaveReceiptSidecarAtomically({
    planPath,
    sidecar: canonicalizeStore(persistedStore(store)),
  })
}

export function stampBaseline(planPath: string): ReceiptWriteResult {
  if (readReceiptQuarantineMarker(planPath) !== null) return { kind: "quarantined" }
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
  const fKey = input.fKey.toUpperCase()
  const stamped = stampBaseline(planPath)
  if (stamped.kind !== "written") return stamped
  if (stamped.store.baseline !== null && !Object.hasOwn(stamped.store.baseline.fRowContract, fKey)) {
    return { kind: "mismatched" }
  }

  const store = {
    ...persistedStore(stamped.store),
    expectations: {
      ...stamped.store.expectations,
      [fKey]: { role: input.role, subagent: input.subagent, launchId: input.launchId, createdAt: input.createdAt ?? nowIso() },
    },
  }
  writeFinalWaveReceiptStore(planPath, store)
  return { kind: "written", store: evaluateContract(store, planPath) }
}

export function recordBinding(planPath: string, input: BindingInput): BindingWriteResult {
  const fKey = input.fKey.toUpperCase()
  const result = readReceiptStore(planPath)
  if ("corrupt" in result) return { kind: "corrupt" }
  if (result.contract.kind === "violation") return { kind: "contract-violation" }
  const expectation = result.expectations[fKey]
  if (expectation === undefined) return { kind: "late" }
  if (expectation.launchId !== input.launchId) return { kind: "stale" }
  const priorBinding = result.bindings[input.launchId]
  if (priorBinding !== undefined && !isBindingMatch(priorBinding, { ...input, fKey })) return { kind: "mismatched" }

  const store = {
    ...persistedStore(result),
    bindings: {
      ...result.bindings,
      [input.launchId]: { fKey, childSessionId: input.childSessionId, boundAt: input.boundAt ?? nowIso() },
    },
  }
  writeFinalWaveReceiptStore(planPath, store)
  return { kind: "recorded", store: evaluateContract(store, planPath) }
}

export function writeReceipt(planPath: string, input: ReceiptInput): ReceiptWriteResult {
  const fKey = input.fKey.toUpperCase()
  const result = readReceiptStore(planPath)
  if ("corrupt" in result) return { kind: "corrupt" }
  if (result.contract.kind === "violation") return { kind: "contract-violation" }
  const existingReceipt = result.receipts[fKey]
  if (existingReceipt !== undefined && isReceiptValid(existingReceipt.fingerprint, input.fingerprint)) {
    return { kind: "duplicate" }
  }
  const expectation = result.expectations[fKey]
  if (expectation === undefined) return { kind: "late" }
  if (expectation.launchId !== input.launchId) return { kind: "stale" }
  const binding = result.bindings[input.launchId]
  if (input.actualAgent !== expectation.subagent || !matchesReceiptBinding(binding, { ...input, fKey })) return { kind: "mismatched" }

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
  const receiptArchive = existingReceipt === undefined
    ? result.receiptArchive
    : { ...result.receiptArchive, [fKey]: [...(result.receiptArchive[fKey] ?? []), existingReceipt] }
  const store = {
    ...persistedStore(result),
    receipts: { ...result.receipts, [fKey]: receipt },
    receiptArchive,
  }
  writeFinalWaveReceiptStore(planPath, store)
  return { kind: "written", store: evaluateContract(store, planPath) }
}

export function revokeReceiptsForFKey(store: FinalWaveReceiptStore | FinalWaveReceiptStoreRead, fKey: string): FinalWaveReceiptStore {
  const receipts = { ...store.receipts }
  delete receipts[fKey.toUpperCase()]
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
  const isGitWorkspace = resolveGitHead(planPath) !== "nogit"
  if (isGitWorkspace) {
    writeFileAtomically(
      receiptQuarantineMarkerPathForPlan(planPath),
      `${JSON.stringify({ version: 1, quarantinedPath: recoveryPath, quarantinedAt: timestamp }, null, 2)}\n`,
    )
  }
  renameSync(sidecarPath, recoveryPath)
  return isGitWorkspace
    ? { kind: "blocking-recovery", path: recoveryPath, message: `Inspect the quarantined receipt, then delete ${receiptQuarantineMarkerPathForPlan(planPath)} to authorize a fresh baseline and re-run every final-wave review.` }
    : { kind: "advisory-recovery", path: recoveryPath, message: "Non-git workspaces remain advisory; re-stamp before the next wave." }
}

export function receiptQuarantineMarkerPathForPlan(planPath: string): string {
  const sidecarPath = receiptStorePathForPlan(planPath)
  return `${sidecarPath.slice(0, -".json".length)}.quarantine.json`
}

export function readReceiptQuarantineMarker(planPath: string): ReceiptQuarantineMarkerRead | null {
  const markerPath = receiptQuarantineMarkerPathForPlan(planPath)
  if (!existsSync(markerPath)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath, "utf-8"))
    const result = QuarantineMarkerSchema.safeParse(parsed)
    return result.success ? result.data : { corrupt: true }
  } catch {
    return { corrupt: true }
  }
}

function parseReceiptStore(raw: string): FinalWaveReceiptStore | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = ReceiptStoreSchema.safeParse(parsed)
    return result.success ? canonicalizeStore(result.data) : null
  } catch {
    return null
  }
}

function evaluateContract(store: FinalWaveReceiptStore, planPath: string): FinalWaveReceiptStoreRead {
  if (store.baseline === null) return { ...store, contract: { kind: "uninitialized" } }
  const material = readPlanMaterial(planPath)
  const currentRows = material?.parsed.status === "marked" ? material.parsed.rows : []
  const rowsByKey = new Map(currentRows.map((row) => [row.fKey.toUpperCase(), normalizeRowContract(row)]))
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
  const gitHead = resolveGitHead(planPath)
  const workspaceRoot = resolveGitWorkspaceRoot(planPath)
  return {
    gitHead,
    planSha256: planSha256(planContent),
    stampedAt: nowIso(),
    dirtyPaths: snapshotCanonicalDirtyPaths({ workspaceRoot, planPath, baselineGitHead: gitHead }),
    fRowContract: Object.fromEntries(rows.map((row) => [row.fKey.toUpperCase(), normalizeRowContract(row)])),
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
  const fromParent = spawnSync("git", ["-C", dirname(path), "rev-parse", "HEAD"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (fromParent.status === 0 && typeof fromParent.stdout === "string" && fromParent.stdout.trim().length > 0) {
    return fromParent.stdout.trim()
  }
  const fromPath = spawnSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  return fromPath.status === 0 && typeof fromPath.stdout === "string" && fromPath.stdout.trim().length > 0
    ? fromPath.stdout.trim()
    : "nogit"
}

function matchesReceiptBinding(binding: FinalWaveReceiptBinding | undefined, input: ReceiptInput): boolean {
  return binding !== undefined && binding.fKey === input.fKey && binding.childSessionId === input.childSessionId
}

function isBindingMatch(binding: FinalWaveReceiptBinding, input: BindingInput): boolean {
  return binding.fKey === input.fKey && binding.childSessionId === input.childSessionId
}

function persistedStore(store: FinalWaveReceiptStore | FinalWaveReceiptStoreRead): FinalWaveReceiptStore {
  return {
    version: 1,
    baseline: store.baseline,
    expectations: store.expectations,
    bindings: store.bindings,
    receipts: store.receipts,
    receiptArchive: store.receiptArchive,
  }
}

function canonicalizeStore(store: FinalWaveReceiptStore): FinalWaveReceiptStore {
  const baseline = store.baseline === null
    ? null
    : { ...store.baseline, fRowContract: canonicalizeRecord(store.baseline.fRowContract) }
  const bindings = Object.fromEntries(Object.entries(store.bindings).map(([launchId, binding]) => [
    launchId,
    { ...binding, fKey: binding.fKey.toUpperCase() },
  ]))
  return {
    ...store,
    baseline,
    expectations: canonicalizeRecord(store.expectations),
    bindings,
    receipts: canonicalizeRecord(store.receipts),
    receiptArchive: canonicalizeRecord(store.receiptArchive),
  }
}

function canonicalizeRecord<Value>(record: Readonly<Record<string, Value>>): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.entries(record).map(([fKey, value]) => [fKey.toUpperCase(), value]))
}

function resolveGitWorkspaceRoot(planPath: string): string {
  const result = spawnSync("git", ["-C", dirname(planPath), "rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  return result.status === 0 && typeof result.stdout === "string" && result.stdout.trim().length > 0
    ? result.stdout.trim()
    : dirname(planPath)
}

function nowIso(): string {
  return new Date().toISOString()
}
