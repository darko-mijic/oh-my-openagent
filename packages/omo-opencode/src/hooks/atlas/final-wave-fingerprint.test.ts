import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { computeRowFingerprint, isReceiptValid } from "./final-wave-fingerprint"

const PLAN_PATH = ".omo/plans/wave.md"

describe("final-wave receipt fingerprints", () => {
  let workspaceRoot = ""

  beforeEach(() => {
    workspaceRoot = join(tmpdir(), `atlas-final-wave-fingerprint-${randomUUID()}`)
    mkdirSync(workspaceRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(workspaceRoot)) {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test("#given a git baseline and an explicit source scope #when only an out-of-scope file changes #then the receipt stays valid", () => {
    // given
    writeWorkspaceFile(workspaceRoot, PLAN_PATH, "# Plan\n")
    writeWorkspaceFile(workspaceRoot, "src/review.ts", "export const version = 1\n")
    writeWorkspaceFile(workspaceRoot, "docs/notes.md", "initial\n")
    initializeGitRepository(workspaceRoot)
    const baseline = { gitHead: runGit(workspaceRoot, ["rev-parse", "HEAD"]).trim() }
    const row = createRow({ role: "code-reviewer", scope: ["src/review.ts"] })
    const receipt = computeRowFingerprint({ planPath: join(workspaceRoot, PLAN_PATH), row, workspaceRoot, baseline })

    // when
    writeWorkspaceFile(workspaceRoot, "docs/notes.md", "out of scope remediation\n")
    const current = computeRowFingerprint({ planPath: join(workspaceRoot, PLAN_PATH), row, workspaceRoot, baseline })

    // then
    expect(current.scopePaths).toEqual(["src/review.ts"])
    expect(isReceiptValid(receipt, current)).toBe(true)
  })

  test("#given a receipt for a source scope #when the scoped file changes #then the receipt is invalid", () => {
    // given
    writeWorkspaceFile(workspaceRoot, PLAN_PATH, "# Plan\n")
    writeWorkspaceFile(workspaceRoot, "src/review.ts", "export const version = 1\n")
    initializeGitRepository(workspaceRoot)
    const baseline = { gitHead: runGit(workspaceRoot, ["rev-parse", "HEAD"]).trim() }
    const row = createRow({ role: "code-reviewer", scope: ["src/review.ts"] })
    const receipt = computeRowFingerprint({ planPath: join(workspaceRoot, PLAN_PATH), row, workspaceRoot, baseline })

    // when
    writeWorkspaceFile(workspaceRoot, "src/review.ts", "export const version = 2\n")
    const current = computeRowFingerprint({ planPath: join(workspaceRoot, PLAN_PATH), row, workspaceRoot, baseline })

    // then
    expect(isReceiptValid(receipt, current)).toBe(false)
  })

  test("#given a git wave baseline #when code-reviewer has no marker scope #then only product diff files become its scope", () => {
    // given
    writeWorkspaceFile(workspaceRoot, PLAN_PATH, "# Plan\n")
    writeWorkspaceFile(workspaceRoot, "src/changed.ts", "export const version = 1\n")
    initializeGitRepository(workspaceRoot)
    const baseline = { gitHead: runGit(workspaceRoot, ["rev-parse", "HEAD"]).trim() }
    writeWorkspaceFile(workspaceRoot, "src/changed.ts", "export const version = 2\n")
    writeWorkspaceFile(workspaceRoot, ".omo/evidence/result.txt", "qa evidence\n")
    commitCurrentChanges(workspaceRoot, "implementation")

    // when
    const fingerprint = computeRowFingerprint({
      planPath: join(workspaceRoot, PLAN_PATH),
      row: createRow({ role: "code-reviewer" }),
      workspaceRoot,
      baseline,
    })

    // then
    expect(fingerprint.gitHead).toBe(baseline.gitHead)
    expect(fingerprint.scopePaths).toEqual(["src/changed.ts"])
  })

  test("#given no marker scopes #when every reviewer role is fingerprinted #then the locked default-scope table applies", () => {
    // given
    writeWorkspaceFile(workspaceRoot, PLAN_PATH, "# Plan\n")
    writeWorkspaceFile(workspaceRoot, "src/changed.ts", "export const version = 1\n")
    initializeGitRepository(workspaceRoot)
    const baseline = { gitHead: runGit(workspaceRoot, ["rev-parse", "HEAD"]).trim() }
    writeWorkspaceFile(workspaceRoot, "src/changed.ts", "export const version = 2\n")
    commitCurrentChanges(workspaceRoot, "implementation")
    const planPath = join(workspaceRoot, PLAN_PATH)

    // when
    const roles = ["plan-auditor", "scope-auditor", "code-reviewer", "qa-executor"] as const
    const scopes = roles.map((role) => {
      const fingerprint = computeRowFingerprint({
        planPath,
        row: createRow({ role }),
        workspaceRoot,
        baseline,
      })
      return [role, fingerprint.scopePaths]
    })

    // then
    expect(scopes).toEqual([
      ["plan-auditor", [PLAN_PATH]],
      ["scope-auditor", [PLAN_PATH]],
      ["code-reviewer", ["src/changed.ts"]],
      ["qa-executor", [PLAN_PATH, ".omo/evidence/"]],
    ])
  })

  test("#given a non-git workspace #when git probing fails #then content hashing falls back to the plan scope", () => {
    // given
    writeWorkspaceFile(workspaceRoot, PLAN_PATH, "# Plan\n")
    writeWorkspaceFile(workspaceRoot, "src/review.ts", "export const version = 1\n")
    const baseline = { gitHead: "frozen-baseline" as const }
    const row = createRow({ role: "code-reviewer" })

    // when
    const receipt = computeRowFingerprint({ planPath: join(workspaceRoot, PLAN_PATH), row, workspaceRoot, baseline })
    writeWorkspaceFile(workspaceRoot, "src/review.ts", "export const version = 2\n")
    const outOfScopeCurrent = computeRowFingerprint({ planPath: join(workspaceRoot, PLAN_PATH), row, workspaceRoot, baseline })
    writeWorkspaceFile(workspaceRoot, PLAN_PATH, "# Updated plan\n")
    const inScopeCurrent = computeRowFingerprint({ planPath: join(workspaceRoot, PLAN_PATH), row, workspaceRoot, baseline })

    // then
    expect(receipt).toMatchObject({ gitHead: "nogit", scopePaths: [PLAN_PATH] })
    expect(isReceiptValid(receipt, outOfScopeCurrent)).toBe(true)
    expect(isReceiptValid(receipt, inScopeCurrent)).toBe(false)
  })

  test("#given a frozen baseline #when fingerprinting a git diff #then it uses that baseline without re-stamping HEAD", () => {
    // given
    writeWorkspaceFile(workspaceRoot, "src/changed.ts", "export const version = 1\n")
    const calls: (readonly string[])[] = []
    const baseline = { gitHead: "frozen-baseline" as const }

    // when
    const fingerprint = computeRowFingerprint({
      planPath: join(workspaceRoot, PLAN_PATH),
      row: createRow({ role: "code-reviewer" }),
      workspaceRoot,
      baseline,
      spawnGit: (arguments_, _cwd) => {
        calls.push(arguments_)
        return arguments_[0] === "rev-parse"
          ? { exitCode: 0, stdout: "live-head-must-not-be-stamped\n" }
          : { exitCode: 0, stdout: "src/changed.ts\n" }
      },
    })

    // then
    expect(fingerprint.gitHead).toBe("frozen-baseline")
    expect(calls).toEqual([
      ["rev-parse", "HEAD"],
      ["diff", "--name-only", "frozen-baseline..HEAD"],
    ])
  })
})

function createRow(input: { readonly role: "plan-auditor" | "code-reviewer" | "qa-executor" | "scope-auditor"; readonly scope?: readonly string[] }) {
  return { fKey: "F1", title: "Final review", role: input.role, scope: input.scope ?? [] } as const
}

function initializeGitRepository(workspaceRoot: string): void {
  runGit(workspaceRoot, ["init"])
  runGit(workspaceRoot, ["config", "user.email", "final-wave@example.test"])
  runGit(workspaceRoot, ["config", "user.name", "Final Wave"])
  runGit(workspaceRoot, ["add", "."])
  runGit(workspaceRoot, ["commit", "-m", "baseline"])
}

function commitCurrentChanges(workspaceRoot: string, message: string): void {
  runGit(workspaceRoot, ["add", "."])
  runGit(workspaceRoot, ["commit", "-m", message])
}

function runGit(workspaceRoot: string, arguments_: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...arguments_], { cwd: workspaceRoot, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }
  return result.stdout.toString()
}

function writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: string): void {
  const path = join(workspaceRoot, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
