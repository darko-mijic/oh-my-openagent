import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { getPlanProgress } from "../../features/boulder-state"
import { buildFinalWaveFixturePlan } from "./final-wave-fixtures"
import { readFinalWavePlanState } from "./final-wave-plan-state"
import {
  quarantineCorruptReceiptStore,
  readReceiptStore,
  recordBinding,
  recordLaunchExpectation,
  reconstructFinalWaveState,
  receiptStorePathForPlan,
  stampBaseline,
  writeReceipt,
} from "./final-wave-receipts"
import { writeMalformedFinalWaveReceiptSidecar } from "./final-wave-receipt-sidecar-writer"

const testDirectories: string[] = []
const fingerprint = { gitHead: "nogit" as const, scopePaths: [], scopeHash: "scope-hash" }

function writePlan(variant: "legacy-unmarked" | "marked-correct" = "marked-correct"): string {
  const directory = join(tmpdir(), `final-wave-receipts-${randomUUID()}`)
  testDirectories.push(directory)
  const planPath = join(directory, ".omo", "plans", "wave.md")
  mkdirSync(dirname(planPath), { recursive: true })
  writeFileSync(planPath, buildFinalWaveFixturePlan({ variant }))
  return planPath
}

function expectValidStore(planPath: string) {
  const result = readReceiptStore(planPath)
  if ("corrupt" in result) throw new Error("expected valid receipt store")
  return result
}

function establishF1(planPath: string, launchId = "launch-f1"): void {
  recordLaunchExpectation(planPath, { fKey: "F1", role: "plan-auditor", subagent: "momus", launchId })
  recordBinding(planPath, { launchId, fKey: "F1", childSessionId: "ses_f1" })
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("final-wave durable receipt store", () => {
  test("#given no sidecar #when read #then returns an empty uninitialized store", () => {
    const store = expectValidStore(writePlan())
    expect(store.baseline).toBeNull()
    expect(store.contract.kind).toBe("uninitialized")
  })

  test("#given a first expectation #when persisted #then stamps the frozen baseline before it", () => {
    const planPath = writePlan()
    recordLaunchExpectation(planPath, { fKey: "F1", role: "plan-auditor", subagent: "momus", launchId: "launch-f1" })
    const store = expectValidStore(planPath)
    expect(store.baseline?.fRowContract.F1?.role).toBe("plan-auditor")
    expect(store.expectations.F1?.launchId).toBe("launch-f1")
  })

  test("#given an initialized wave #when later expectations are persisted #then its baseline is never re-stamped", () => {
    const planPath = writePlan()
    stampBaseline(planPath)
    const firstStamp = expectValidStore(planPath).baseline?.stampedAt
    recordLaunchExpectation(planPath, { fKey: "F2", role: "code-reviewer", subagent: "oracle", launchId: "launch-f2" })
    expect(expectValidStore(planPath).baseline?.stampedAt).toBe(firstStamp)
  })

  test("#given malformed sidecar JSON #when read #then reports corrupt without throwing", () => {
    const planPath = writePlan()
    writeMalformedFinalWaveReceiptSidecar(planPath)
    expect(readReceiptStore(planPath)).toEqual({ corrupt: true })
  })

  test("#given a corrupt marked sidecar #when quarantined #then moves it to a recovery path", () => {
    const planPath = writePlan()
    const sidecarPath = writeMalformedFinalWaveReceiptSidecar(planPath)
    const recovery = quarantineCorruptReceiptStore(planPath, "123")
    expect(recovery.kind).toBe("advisory-recovery")
    expect(recovery.path).toEndWith("wave.receipts.corrupt-123.json")
    expect(existsSync(sidecarPath)).toBe(false)
    expect(existsSync(recovery.path)).toBe(true)
  })

  test("#given a corrupt legacy sidecar #when recovery is assessed #then it remains advisory", () => {
    const planPath = writePlan("legacy-unmarked")
    writeMalformedFinalWaveReceiptSidecar(planPath)
    expect(quarantineCorruptReceiptStore(planPath, "456").kind).toBe("advisory")
  })

  test("#given an expectation #when its child session binds #then the durable binding matches", () => {
    const planPath = writePlan()
    establishF1(planPath)
    expect(expectValidStore(planPath).bindings["launch-f1"]?.childSessionId).toBe("ses_f1")
  })

  test("#given an unknown launch #when a binding is written #then it is rejected as late", () => {
    expect(recordBinding(writePlan(), { launchId: "missing", fKey: "F1", childSessionId: "ses_f1" }).kind).toBe("late")
  })

  test("#given a bound expected completion #when written #then persists its approval receipt", () => {
    const planPath = writePlan()
    establishF1(planPath)
    expect(writeReceipt(planPath, { fKey: "F1", launchId: "launch-f1", childSessionId: "ses_f1", actualAgent: "momus", fingerprint }).kind).toBe("written")
    expect(expectValidStore(planPath).receipts.F1?.verdict).toBe("approve")
  })

  test("#given an approved row #when completed again #then rejects the duplicate", () => {
    const planPath = writePlan()
    establishF1(planPath)
    writeReceipt(planPath, { fKey: "F1", launchId: "launch-f1", childSessionId: "ses_f1", actualAgent: "momus", fingerprint })
    expect(writeReceipt(planPath, { fKey: "F1", launchId: "launch-f1", childSessionId: "ses_f1", actualAgent: "momus", fingerprint }).kind).toBe("duplicate")
  })

  test("#given no expectation #when completed #then rejects it as late", () => {
    expect(writeReceipt(writePlan(), { fKey: "F1", launchId: "none", childSessionId: "ses_f1", actualAgent: "momus", fingerprint }).kind).toBe("late")
  })

  test("#given a replaced expectation #when the earlier launch completes #then rejects it as stale", () => {
    const planPath = writePlan()
    establishF1(planPath, "current")
    expect(writeReceipt(planPath, { fKey: "F1", launchId: "old", childSessionId: "ses_f1", actualAgent: "momus", fingerprint }).kind).toBe("stale")
  })

  test("#given a bound expectation #when another agent completes it #then rejects it as mismatched", () => {
    const planPath = writePlan()
    establishF1(planPath)
    expect(writeReceipt(planPath, { fKey: "F1", launchId: "launch-f1", childSessionId: "ses_f1", actualAgent: "oracle", fingerprint }).kind).toBe("mismatched")
  })

  test("#given a known launch with an unknown child #when completed #then rejects it as mismatched", () => {
    const planPath = writePlan()
    establishF1(planPath)
    expect(writeReceipt(planPath, { fKey: "F1", launchId: "launch-f1", childSessionId: "ses_other", actualAgent: "momus", fingerprint }).kind).toBe("mismatched")
  })

  test("#given persisted approvals #when re-read after restart #then reconstruction is identical", () => {
    const planPath = writePlan()
    establishF1(planPath)
    writeReceipt(planPath, { fKey: "F1", launchId: "launch-f1", childSessionId: "ses_f1", actualAgent: "momus", fingerprint })
    const first = reconstructFinalWaveState(expectValidStore(planPath))
    const second = reconstructFinalWaveState(expectValidStore(planPath))
    expect(second).toEqual(first)
    expect(first.approvedCount).toBe(1)
  })

  test("#given an intact frozen contract #when unrelated plan prose changes #then receipts remain valid", () => {
    const planPath = writePlan()
    establishF1(planPath)
    writeReceipt(planPath, { fKey: "F1", launchId: "launch-f1", childSessionId: "ses_f1", actualAgent: "momus", fingerprint })
    writeFileSync(planPath, `${readFileSync(planPath, "utf-8")}\nUnrelated prose change.\n`)
    const store = expectValidStore(planPath)
    expect(store.contract.kind).toBe("intact")
    expect(store.receipts.F1).toBeDefined()
  })

  test("#given a frozen row #when its title changes #then the contract revokes its receipt", () => {
    const planPath = writePlan()
    establishF1(planPath)
    writeReceipt(planPath, { fKey: "F1", launchId: "launch-f1", childSessionId: "ses_f1", actualAgent: "momus", fingerprint })
    writeFileSync(planPath, readFileSync(planPath, "utf-8").replace("Plan compliance audit", "Mutated plan audit"))
    const store = expectValidStore(planPath)
    expect(store.contract.kind).toBe("violation")
    expect(store.receipts.F1).toBeUndefined()
  })

  test("#given a frozen row #when its scope changes #then the contract records a violation", () => {
    const planPath = writePlan()
    stampBaseline(planPath)
    writeFileSync(planPath, readFileSync(planPath, "utf-8").replace("<!-- role:plan-auditor -->", "<!-- role:plan-auditor scope:src/a.ts -->"))
    expect(expectValidStore(planPath).contract.kind).toBe("violation")
  })

  test("#given an unreceipted frozen row #when deleted #then reconstruction keeps it required", () => {
    const planPath = writePlan()
    stampBaseline(planPath)
    writeFileSync(planPath, readFileSync(planPath, "utf-8").replace(/^.*F4.*\n/m, ""))
    const state = reconstructFinalWaveState(expectValidStore(planPath))
    expect(state.requiredCount).toBe(4)
    expect(state.waitingForApproval).toBe(false)
  })

  test("#given a receipt sidecar #when plan progress is read #then the sidecar is invisible to plan readers", () => {
    const planPath = writePlan()
    establishF1(planPath)
    expect(readFileSync(receiptStorePathForPlan(planPath), "utf-8")).toContain("expectations")
    expect(getPlanProgress(planPath)).toMatchObject({ total: 1, completed: 1 })
    expect(readFinalWavePlanState(planPath)).toMatchObject({ pendingImplementationTaskCount: 0, pendingFinalWaveTaskCount: 4 })
  })
})
