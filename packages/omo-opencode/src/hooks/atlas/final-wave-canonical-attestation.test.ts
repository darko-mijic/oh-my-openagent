import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { attestCanonicalTreeClean } from "./final-wave-canonical-attestation"
import { stampBaseline } from "./final-wave-receipts"

const testDirectories: string[] = []

afterEach(() => {
  for (const directory of testDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("attestCanonicalTreeClean", () => {
  test("#given product dirt existed at baseline #when attested before and after new dirt #then only the new path fails", () => {
    // given
    const directory = createGitWorkspace()
    const planPath = writePlan(directory)
    writeWorkspaceFile(directory, "src/preexisting.ts", "preexisting\n")
    const stamp = stampBaseline(planPath)
    if (stamp.kind !== "written" || stamp.store.baseline === null) throw new Error("expected baseline")

    // when
    const beforeNewDirt = attestCanonicalTreeClean({
      workspaceRoot: directory,
      planPath,
      baselineGitHead: stamp.store.baseline.gitHead,
    })
    writeWorkspaceFile(directory, "src/new.ts", "new\n")
    const afterNewDirt = attestCanonicalTreeClean({
      workspaceRoot: directory,
      planPath,
      baselineGitHead: stamp.store.baseline.gitHead,
    })

    // then
    expect(beforeNewDirt).toEqual({ ok: true })
    expect(afterNewDirt).toEqual({ ok: false, dirtyPaths: ["src/new.ts"] })
  })

  test("#given a non-git baseline #when attested #then it remains acceptable", () => {
    // given
    const directory = join(tmpdir(), `final-wave-attestation-nogit-${randomUUID()}`)
    testDirectories.push(directory)
    const planPath = writePlan(directory)
    writeWorkspaceFile(directory, "src/new.ts", "new\n")

    // when
    const result = attestCanonicalTreeClean({ workspaceRoot: directory, planPath, baselineGitHead: "nogit" })

    // then
    expect(result).toEqual({ ok: true })
  })
})

function createGitWorkspace(): string {
  const directory = join(tmpdir(), `final-wave-attestation-${randomUUID()}`)
  testDirectories.push(directory)
  mkdirSync(directory, { recursive: true })
  runGit(directory, ["init"])
  runGit(directory, ["config", "user.email", "attestation@example.test"])
  runGit(directory, ["config", "user.name", "Attestation"])
  writeWorkspaceFile(directory, "README.md", "baseline\n")
  runGit(directory, ["add", "README.md"])
  runGit(directory, ["commit", "-m", "baseline"])
  return directory
}

function writePlan(directory: string): string {
  const planPath = join(directory, ".omo", "plans", "wave.md")
  mkdirSync(dirname(planPath), { recursive: true })
  writeFileSync(planPath, [
    "## Final Verification Wave",
    "- [ ] F1. Plan audit <!-- role:plan-auditor -->",
  ].join("\n"))
  return planPath
}

function writeWorkspaceFile(directory: string, relativePath: string, content: string): void {
  const path = join(directory, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function runGit(cwd: string, arguments_: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...arguments_], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
