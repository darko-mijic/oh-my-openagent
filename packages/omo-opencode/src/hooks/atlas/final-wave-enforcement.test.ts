import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { shouldPauseForFinalWaveApproval } from "./final-wave-approval-gate"
import {
  hasFinalWaveReceiptForRow,
  resolveFinalWaveEnforcement,
} from "./final-wave-enforcement"
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
import { writeMalformedFinalWaveReceiptSidecar } from "./final-wave-receipt-sidecar-writer"
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

function establishReceipt(planPath: string, fKey: "F1" | "F2" | "F3" | "F4"): void {
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
  writeReceipt(planPath, {
    fKey,
    launchId,
    childSessionId: `ses_${fKey}`,
    actualAgent: row.subagent,
    fingerprint: { gitHead: "nogit", scopePaths: [], scopeHash: "hash" },
  })
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
    expect(enforcement.recovery).toBeDefined()
    expect(enforcement.recovery?.includes(".corrupt-")).toBe(true)
    expect(readFileSync(enforcement.recovery!, "utf-8").length).toBeGreaterThan(0)
    // Sidecar moved off the live path.
    expect(() => readFileSync(sidecarPath, "utf-8")).toThrow()
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
    establishReceipt(planPath, "F1")
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
      establishReceipt(planPath, fKey)
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
    establishReceipt(planPath, "F3")

    // when / then
    expect(hasFinalWaveReceiptForRow(planPath, "F3")).toBe(true)
    expect(hasFinalWaveReceiptForRow(planPath, "F1")).toBe(false)
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
