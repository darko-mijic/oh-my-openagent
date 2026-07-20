import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { shouldPauseForFinalWaveApproval } from "./final-wave-approval-gate"
import {
  hasAllFinalWaveReceipts,
  hasFinalWaveReceiptForRow,
  resolveFinalWaveEnforcement,
} from "./final-wave-enforcement"
import { computeRowFingerprint } from "./final-wave-fingerprint"
import {
  buildFinalWaveFixturePlan,
  FINAL_WAVE_FIXTURE_ROWS,
  writeFinalWaveFixturePlan,
} from "./final-wave-fixtures"
import { authorizeMarkedFinalWaveLaunch } from "./final-wave-launch-authorization"
import {
  readReceiptStore,
  recordBinding,
  recordLaunchExpectation,
  stampBaseline,
  writeReceipt,
} from "./final-wave-receipts"
import { readFinalWavePlanState } from "./final-wave-plan-state"
import { writeMalformedFinalWaveReceiptSidecar } from "./final-wave-receipt-test-support"
import type { SessionState } from "./types"

const testDirectories: string[] = []

function createWorkspace(initGit = false): string {
  const directory = join(tmpdir(), `final-wave-enforcement-${randomUUID()}`)
  testDirectories.push(directory)
  mkdirSync(join(directory, ".omo", "plans"), { recursive: true })
  if (initGit) {
    runGit(directory, ["init"])
    runGit(directory, ["config", "user.email", "test@example.com"])
    runGit(directory, ["config", "user.name", "Test"])
    writeFileSync(join(directory, "README.md"), "fixture\n")
    runGit(directory, ["add", "README.md"])
    runGit(directory, ["commit", "-m", "init"])
  }
  return directory
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  }
}

function writeMarkedPlan(directory: string, completed: readonly ("F1" | "F2" | "F3" | "F4")[] = []): string {
  return writeFinalWaveFixturePlan({
    workspaceRoot: directory,
    slug: "wave",
    variant: "marked-correct",
    completedFinalWaveKeys: completed,
  }).planPath
}

function writeLegacyPlan(directory: string): string {
  return writeFinalWaveFixturePlan({
    workspaceRoot: directory,
    slug: "legacy",
    variant: "legacy-unmarked",
  }).planPath
}

function writeMixedPlan(directory: string): string {
  const planPath = join(directory, ".omo", "plans", "mixed.md")
  writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Ship implementation

## Final Verification Wave
- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->
- [ ] F2. Code quality review
- [ ] F3. Real manual QA <!-- role:qa-executor -->
- [ ] F4. Scope fidelity check <!-- role:scope-auditor -->
`)
  return planPath
}

function emptySessionState(): SessionState {
  return { promptFailureCount: 0 }
}

function establishReceipt(
  planPath: string,
  workspaceRoot: string,
  fKey: "F1" | "F2" | "F3" | "F4",
): void {
  const row = FINAL_WAVE_FIXTURE_ROWS[fKey]
  const launchId = `launch-${fKey}`
  recordLaunchExpectation(planPath, {
    fKey,
    role: row.role,
    subagent: row.subagent,
    launchId,
  })
  recordBinding(planPath, {
    launchId,
    fKey,
    childSessionId: `ses_${fKey}`,
  })
  const store = readReceiptStore(planPath)
  const planState = readFinalWavePlanState(planPath)
  if ("corrupt" in store || store.baseline === null || planState?.finalWaveRoles.status !== "marked") {
    throw new Error("expected initialized final-wave receipt fixture")
  }
  const fingerprintRow = planState.finalWaveRoles.rows.find((candidate) => candidate.fKey === fKey)
  if (fingerprintRow === undefined) throw new Error(`expected ${fKey} fixture row`)
  writeReceipt(planPath, {
    fKey,
    launchId,
    childSessionId: `ses_${fKey}`,
    actualAgent: row.subagent,
    fingerprint: computeRowFingerprint({
      planPath,
      row: fingerprintRow,
      workspaceRoot,
      baseline: { gitHead: store.baseline.gitHead },
    }),
  })
}

function establishImplicitCodeReviewerWave(directory: string): string {
  const planPath = writeMarkedPlan(directory)
  mkdirSync(join(directory, "src"), { recursive: true })
  writeFileSync(join(directory, "src", "baseline.ts"), "export const baseline = 1\n")
  runGit(directory, ["add", "src/baseline.ts"])
  runGit(directory, ["commit", "-m", "baseline product file"])
  stampBaseline(planPath)
  writeFileSync(join(directory, "src", "implementation.ts"), "export const implementation = 1\n")
  runGit(directory, ["add", "src/implementation.ts"])
  runGit(directory, ["commit", "-m", "implementation"])
  for (const fKey of ["F1", "F2", "F3", "F4"] as const) {
    establishReceipt(planPath, directory, fKey)
  }
  return planPath
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("resolveFinalWaveEnforcement", () => {
  test("#given marked plan in git with empty sidecar #when resolved #then mode is enforced", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("enforced")
  })

  test("#given marked plan outside git #when resolved #then mode is advisory", () => {
    // given
    const directory = createWorkspace(false)
    const planPath = writeMarkedPlan(directory)
    stampBaseline(planPath)

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("advisory")
    expect(enforcement.reason).toBe("non-git-workspace")
  })

  test("#given legacy-unmarked plan #when resolved #then mode is advisory", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeLegacyPlan(directory)

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("advisory")
    expect(enforcement.reason).toBe("legacy-unmarked")
  })

  test("#given mixed-marked plan #when resolved #then mode is advisory", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMixedPlan(directory)

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("advisory")
    expect(enforcement.reason).toBe("mixed-or-invalid")
  })

  test("#given a stamped marked git plan #when role markers are stripped #then enforcement stays blocked", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    stampBaseline(planPath)
    writeFileSync(planPath, readFileSync(planPath, "utf-8").replace(/ <!-- role:[^>]+ -->/g, ""))

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("blocked")
    expect(enforcement.reason).toBe("stamped-plan-role-contract-lost")
    if (enforcement.mode !== "blocked") throw new Error("expected blocked enforcement")
    expect(enforcement.recovery).toBeDefined()
  })

  test("#given a stamped marked git plan #when the plan becomes unreadable #then enforcement stays blocked", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    stampBaseline(planPath)
    unlinkSync(planPath)

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("blocked")
    expect(enforcement.reason).toBe("stamped-plan-unreadable")
  })

  test("#given corrupt sidecar on marked git plan #when resolved #then mode is blocked and quarantine runs", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    const sidecarPath = writeMalformedFinalWaveReceiptSidecar(planPath)

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("blocked")
    expect(enforcement.reason).toBe("corrupt-sidecar")
    if (enforcement.mode !== "blocked") throw new Error("expected blocked")
    const recoveryPath = enforcement.recovery
    if (recoveryPath === undefined) throw new Error("expected recovery path")
    expect(recoveryPath.includes(".corrupt-")).toBe(true)
    expect(readFileSync(recoveryPath, "utf-8").length).toBeGreaterThan(0)
    const markerPath = `${sidecarPath.slice(0, -".json".length)}.quarantine.json`
    expect(JSON.parse(readFileSync(markerPath, "utf-8"))).toMatchObject({
      version: 1,
      quarantinedPath: recoveryPath,
    })
    // Sidecar moved off the live path.
    expect(() => readFileSync(sidecarPath, "utf-8")).toThrow()
  })

  test("#given a quarantined marked git sidecar #when enforcement runs again #then it remains blocked until marker removal", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    writeMalformedFinalWaveReceiptSidecar(planPath)
    const first = resolveFinalWaveEnforcement(planPath, directory)
    if (first.mode !== "blocked") throw new Error("expected initial quarantine block")

    // when
    const second = resolveFinalWaveEnforcement(planPath, directory)
    const stamp = stampBaseline(planPath)

    // then
    expect(second.mode).toBe("blocked")
    expect(second.reason).toBe("quarantine-recovery-required")
    expect(stamp.kind).toBe("quarantined")
  })

  test("#given corrupt sidecar on legacy plan #when resolved #then mode stays advisory", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeLegacyPlan(directory)
    writeMalformedFinalWaveReceiptSidecar(planPath)

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("advisory")
  })

  test("#given F-row deletion after baseline stamp on marked git plan #when resolved #then mode is blocked", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    stampBaseline(planPath)
    writeFileSync(planPath, readFileSync(planPath, "utf-8").replace(/^.*F4.*\n/m, ""))

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("blocked")
    expect(enforcement.reason).toBe("contract-violation")
  })

  test("#given title mutation after baseline stamp #when resolved #then mode is blocked and receipt is revoked", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    establishReceipt(planPath, directory, "F1")
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf-8").replace("Plan compliance audit", "Mutated plan audit"),
    )

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)
    const store = readReceiptStore(planPath)

    // then
    expect(enforcement.mode).toBe("blocked")
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(store.contract.kind).toBe("violation")
    expect(store.receipts.F1).toBeUndefined()
  })
})

describe("shouldPauseForFinalWaveApproval under enforcement", () => {
  test("#given all F boxes checked with zero receipts #when approve text arrives #then gate does not release", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory, ["F1", "F2", "F3", "F4"])
    stampBaseline(planPath)
    const sessionState = emptySessionState()

    // when
    const shouldPause = shouldPauseForFinalWaveApproval({
      planPath,
      taskOutput: "VERDICT: APPROVE",
      sessionState,
      workspaceRoot: directory,
    })

    // then — not enough receipts for the user-approval gate, and checkboxes alone never authorize
    expect(shouldPause).toBe(false)
    expect(hasFinalWaveReceiptForRow(planPath, "F1")).toBe(false)
  })

  test("#given all required receipts present #when gate is evaluated #then it pauses for user approval", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    for (const fKey of ["F1", "F2", "F3", "F4"] as const) {
      establishReceipt(planPath, directory, fKey)
    }
    const sessionState = emptySessionState()

    // when
    const shouldPause = shouldPauseForFinalWaveApproval({
      planPath,
      taskOutput: "anything",
      sessionState,
      workspaceRoot: directory,
    })

    // then
    expect(shouldPause).toBe(true)
  })

  test("#given legacy plan #when approve verdicts accumulate #then checkbox/verdict behavior is unchanged", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = join(directory, ".omo", "plans", "legacy-gate.md")
    writeFileSync(planPath, buildFinalWaveFixturePlan({ variant: "legacy-unmarked" }))
    const sessionState = emptySessionState()

    // when
    const first = shouldPauseForFinalWaveApproval({
      planPath,
      taskOutput: "VERDICT: APPROVE",
      sessionState,
      workspaceRoot: directory,
    })
    const second = shouldPauseForFinalWaveApproval({
      planPath,
      taskOutput: "VERDICT: APPROVE",
      sessionState,
      workspaceRoot: directory,
    })
    const third = shouldPauseForFinalWaveApproval({
      planPath,
      taskOutput: "VERDICT: APPROVE",
      sessionState,
      workspaceRoot: directory,
    })
    const fourth = shouldPauseForFinalWaveApproval({
      planPath,
      taskOutput: "VERDICT: APPROVE",
      sessionState,
      workspaceRoot: directory,
    })

    // then
    expect(first).toBe(false)
    expect(second).toBe(false)
    expect(third).toBe(false)
    expect(fourth).toBe(true)
  })

  test("#given injected VERDICT text without a receipt #when enforced #then pause is not granted by text alone", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory, ["F1", "F2", "F3"])
    stampBaseline(planPath)
    const sessionState = emptySessionState()

    // when
    const shouldPause = shouldPauseForFinalWaveApproval({
      planPath,
      taskOutput: "I reviewed everything.\nVERDICT: APPROVE",
      sessionState,
      workspaceRoot: directory,
    })

    // then
    expect(shouldPause).toBe(false)
    expect(hasFinalWaveReceiptForRow(planPath, "F4")).toBe(false)
  })
})

describe("authorizeMarkedFinalWaveLaunch under enforcement", () => {
  test("#given category-routed F launch on enforced plan #when authorized #then launch is rejected without expectation", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    const toolOutput = {
      args: {
        prompt: "F2. Code quality review",
        category: "unspecified-high",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    const result = authorizeMarkedFinalWaveLaunch({
      planPath,
      trackedTask: {
        key: "final-wave:F2",
        label: "F2",
        title: "Code quality review",
        section: "final-wave",
      },
      args: toolOutput.args,
      toolOutput,
      sessionID: "ses_atlas",
      callID: "call-reject",
      workspaceRoot: directory,
    })

    // then
    expect(result.kind).toBe("rejected")
    expect(toolOutput.message).toContain("final-wave-named-reviewer-rejection")
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(store.expectations.F2).toBeUndefined()
  })

  test("#given correct named subagent on enforced plan #when authorized #then expectation is persisted", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    const toolOutput = {
      args: {
        prompt: "F2. Code quality review",
        subagent_type: "oracle",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    const result = authorizeMarkedFinalWaveLaunch({
      planPath,
      trackedTask: {
        key: "final-wave:F2",
        label: "F2",
        title: "Code quality review",
        section: "final-wave",
      },
      args: toolOutput.args,
      toolOutput,
      sessionID: "ses_atlas",
      callID: "call-ok",
      workspaceRoot: directory,
    })

    // then
    expect(result.kind).toBe("authorized")
    if (result.kind !== "authorized") throw new Error("expected authorized")
    expect(result.task.expectedSubagent).toBe("oracle")
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(store.expectations.F2?.subagent).toBe("oracle")
  })

  test("#given category-routed F launch on non-git marked plan #when authorized #then stays advisory", () => {
    // given
    const directory = createWorkspace(false)
    const planPath = writeMarkedPlan(directory)
    const toolOutput = {
      args: {
        prompt: "F2. Code quality review",
        category: "unspecified-high",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    const result = authorizeMarkedFinalWaveLaunch({
      planPath,
      trackedTask: {
        key: "final-wave:F2",
        label: "F2",
        title: "Code quality review",
        section: "final-wave",
      },
      args: toolOutput.args,
      toolOutput,
      sessionID: "ses_atlas",
      callID: "call-advisory",
      workspaceRoot: directory,
    })

    // then
    expect(result.kind).toBe("authorized")
    expect(toolOutput.message).toContain("final-wave-named-reviewer-advisory")
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(store.expectations.F2).toBeDefined()
  })
})

describe("hasFinalWaveReceiptForRow", () => {
  test("#given receipt present #when queried #then returns true", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    establishReceipt(planPath, directory, "F3")

    // when / then
    expect(hasFinalWaveReceiptForRow(planPath, "F3")).toBe(true)
    expect(hasFinalWaveReceiptForRow(planPath, "F1")).toBe(false)
  })
})

describe("receipt fingerprint revalidation", () => {
  test("#given all receipts approve explicit scopes #when an in-scope file changes #then the release gate rejects the stale receipt without deleting it", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    writeFileSync(planPath, readFileSync(planPath, "utf-8").replace(
      "<!-- role:code-reviewer -->",
      "<!-- role:code-reviewer scope:src/review.ts -->",
    ))
    mkdirSync(join(directory, "src"), { recursive: true })
    writeFileSync(join(directory, "src", "review.ts"), "export const version = 1\n")
    for (const fKey of ["F1", "F2", "F3", "F4"] as const) {
      establishReceipt(planPath, directory, fKey)
    }
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(true)

    // when
    writeFileSync(join(directory, "src", "review.ts"), "export const version = 2\n")

    // then
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(false)
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(store.receipts.F2).toBeDefined()
  })

  test("#given all four receipts exist #when F-row checkbox states change #then every receipt remains valid", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    for (const fKey of ["F1", "F2", "F3", "F4"] as const) {
      establishReceipt(planPath, directory, fKey)
    }

    // when
    writeFileSync(planPath, readFileSync(planPath, "utf-8")
      .replace("- [ ] F1.", "- [x] F1.")
      .replace("- [ ] F2.", "- [X] F2.")
      .replace("- [ ] F3.", "- [~] F3."))

    // then
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(true)
    for (const fKey of ["F1", "F2", "F3", "F4"] as const) {
      expect(hasFinalWaveReceiptForRow(planPath, fKey, directory)).toBe(true)
    }
  })

  test("#given receipts use the wave-init baseline #when a later out-of-scope commit lands #then every receipt still counts without moving the baseline", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    stampBaseline(planPath)
    const stamped = readReceiptStore(planPath)
    if ("corrupt" in stamped || stamped.baseline === null) throw new Error("expected stamped baseline")
    const frozenGitHead = stamped.baseline.gitHead
    mkdirSync(join(directory, "src"), { recursive: true })
    writeFileSync(join(directory, "src", "review.ts"), "export const version = 1\n")
    runGit(directory, ["add", "-f", planPath, join(directory, "src", "review.ts")])
    runGit(directory, ["commit", "-m", "implementation"])
    for (const fKey of ["F1", "F2", "F3", "F4"] as const) {
      establishReceipt(planPath, directory, fKey)
    }

    // when
    mkdirSync(join(directory, ".omo", "notepads"), { recursive: true })
    const remediationPath = join(directory, ".omo", "notepads", "remediation.md")
    writeFileSync(remediationPath, "out of scope\n")
    runGit(directory, ["add", "-f", remediationPath])
    runGit(directory, ["commit", "-m", "out-of-scope remediation"])

    // then
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(true)
    const current = readReceiptStore(planPath)
    if ("corrupt" in current) throw new Error("expected valid store")
    expect(current.baseline?.gitHead).toBe(frozenGitHead)
  })

  test("#given a receipt in a non-git workspace #when scoped content changes #then hash revalidation returns false without throwing", () => {
    // given
    const directory = createWorkspace(false)
    const planPath = writeMarkedPlan(directory)
    writeFileSync(planPath, readFileSync(planPath, "utf-8").replace(
      "<!-- role:code-reviewer -->",
      "<!-- role:code-reviewer scope:src/review.ts -->",
    ))
    mkdirSync(join(directory, "src"), { recursive: true })
    writeFileSync(join(directory, "src", "review.ts"), "export const version = 1\n")
    establishReceipt(planPath, directory, "F2")
    expect(hasFinalWaveReceiptForRow(planPath, "F2", directory)).toBe(true)

    // when
    writeFileSync(join(directory, "src", "review.ts"), "export const version = 2\n")

    // then
    expect(() => hasFinalWaveReceiptForRow(planPath, "F2", directory)).not.toThrow()
    expect(hasFinalWaveReceiptForRow(planPath, "F2", directory)).toBe(false)
  })

  test("#given an unscoped code-reviewer receipt #when a previously out-of-scope product path is modified but uncommitted #then the release gate stays closed", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = establishImplicitCodeReviewerWave(directory)
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(true)

    // when
    writeFileSync(join(directory, "src", "baseline.ts"), "export const baseline = 2\n")

    // then
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(false)
  })

  test("#given an unscoped code-reviewer receipt #when a new untracked product file appears #then the release gate stays closed", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = establishImplicitCodeReviewerWave(directory)
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(true)

    // when
    writeFileSync(join(directory, "src", "untracked.ts"), "export const untracked = true\n")

    // then
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(false)
  })

  test("#given an unscoped code-reviewer receipt #when an untracked file appears under .omo #then the receipt remains valid", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = establishImplicitCodeReviewerWave(directory)

    // when
    mkdirSync(join(directory, ".omo", "scratch"), { recursive: true })
    writeFileSync(join(directory, ".omo", "scratch", "runtime.txt"), "runtime churn\n")

    // then
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(true)
  })
})

describe("scope mutation post-init", () => {
  test("#given frozen scope #when scope mutates #then contract blocks release", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    stampBaseline(planPath)
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf-8").replace(
        "<!-- role:code-reviewer -->",
        "<!-- role:code-reviewer scope:src/b.ts -->",
      ),
    )

    // when
    const enforcement = resolveFinalWaveEnforcement(planPath, directory)

    // then
    expect(enforcement.mode).toBe("blocked")
    expect(enforcement.reason).toBe("contract-violation")
  })
})
