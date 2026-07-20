import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
import type { FinalWaveReceiptFingerprint } from "./final-wave-receipt-sidecar-writer"
import type { FinalWaveRoleRow } from "./final-wave-role-parser"

const QA_EVIDENCE_SCOPE = ".omo/evidence/"

export type FinalWaveFingerprintBaseline = {
  readonly gitHead: string | "nogit"
}

export type FinalWaveGitCommandResult = {
  readonly exitCode: number | null
  readonly stdout: string
}

export type FinalWaveGitSpawn = (
  arguments_: readonly string[],
  workspaceRoot: string,
) => FinalWaveGitCommandResult

export type ComputeRowFingerprintInput = {
  readonly planPath: string
  readonly row: FinalWaveRoleRow
  readonly workspaceRoot: string
  readonly baseline: FinalWaveFingerprintBaseline
  readonly spawnGit?: FinalWaveGitSpawn
}

export function computeRowFingerprint(input: ComputeRowFingerprintInput): FinalWaveReceiptFingerprint {
  const workspaceRoot = resolve(input.workspaceRoot)
  const planScope = workspaceRelativePath(workspaceRoot, input.planPath)
  const gitDiffPaths = diffPathsSinceBaseline({
    workspaceRoot,
    baseline: input.baseline,
    spawnGit: input.spawnGit ?? spawnGit,
  })
  const scopePaths = effectiveScopePaths({ row: input.row, planScope, gitDiffPaths, workspaceRoot })

  return {
    gitHead: gitDiffPaths === null ? "nogit" : input.baseline.gitHead,
    scopePaths,
    scopeHash: hashScopedFiles(workspaceRoot, scopePaths),
  }
}

export function isReceiptValid(
  receipt: FinalWaveReceiptFingerprint,
  current: FinalWaveReceiptFingerprint,
): boolean {
  return receipt.scopeHash === current.scopeHash && sameScopePaths(receipt.scopePaths, current.scopePaths)
}

function effectiveScopePaths(input: {
  readonly row: FinalWaveRoleRow
  readonly planScope: string
  readonly gitDiffPaths: readonly string[] | null
  readonly workspaceRoot: string
}): readonly string[] {
  if (input.row.scope.length > 0) {
    return uniqueScopePaths(input.row.scope.map((scopePath) => normalizeScopePath(input.workspaceRoot, scopePath)))
  }

  switch (input.row.role) {
    case "plan-auditor":
    case "scope-auditor":
      return [input.planScope]
    case "code-reviewer":
      return input.gitDiffPaths === null
        ? [input.planScope]
        : input.gitDiffPaths.filter((path) => isProductDiffPath(path, input.planScope))
    case "qa-executor":
      return [input.planScope, QA_EVIDENCE_SCOPE]
    default:
      return assertNever(input.row.role)
  }
}

function diffPathsSinceBaseline(input: {
  readonly workspaceRoot: string
  readonly baseline: FinalWaveFingerprintBaseline
  readonly spawnGit: FinalWaveGitSpawn
}): readonly string[] | null {
  if (input.baseline.gitHead === "nogit") return null

  const repositoryProbe = input.spawnGit(["rev-parse", "HEAD"], input.workspaceRoot)
  if (repositoryProbe.exitCode !== 0) return null

  const diff = input.spawnGit(
    ["diff", "--name-only", `${input.baseline.gitHead}..HEAD`],
    input.workspaceRoot,
  )
  if (diff.exitCode !== 0) return null

  return uniqueScopePaths(diff.stdout.split(/\r?\n/).filter(Boolean).map(normalizeGitPath))
}

function isProductDiffPath(path: string, planScope: string): boolean {
  return path === planScope || !path.startsWith(".omo/")
}

function hashScopedFiles(workspaceRoot: string, scopePaths: readonly string[]): string {
  const filePaths = new Set<string>()
  for (const scopePath of scopePaths) {
    collectScopedFiles(workspaceRoot, resolve(workspaceRoot, scopePath), filePaths)
  }

  const entries = [...filePaths]
    .toSorted()
    .map((filePath) => `${filePath}\u0000${createHash("sha256").update(readFileSync(resolve(workspaceRoot, filePath))).digest("hex")}`)
  return createHash("sha256").update(entries.join("\n")).digest("hex")
}

function collectScopedFiles(workspaceRoot: string, absolutePath: string, filePaths: Set<string>): void {
  if (!isWorkspacePath(workspaceRoot, absolutePath) || !existsSync(absolutePath)) return

  const stats = lstatSync(absolutePath)
  if (stats.isFile()) {
    filePaths.add(workspaceRelativePath(workspaceRoot, absolutePath))
    return
  }
  if (!stats.isDirectory()) return

  for (const entry of readdirSync(absolutePath, { withFileTypes: true }).toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isFile() || entry.isDirectory()) {
      collectScopedFiles(workspaceRoot, resolve(absolutePath, entry.name), filePaths)
    }
  }
}

function normalizeScopePath(workspaceRoot: string, scopePath: string): string {
  const hasTrailingSeparator = scopePath.endsWith("/") || scopePath.endsWith("\\")
  const normalized = workspaceRelativePath(workspaceRoot, scopePath)
  return hasTrailingSeparator && normalized !== "." ? `${normalized}/` : normalized
}

function normalizeGitPath(path: string): string {
  return path.split("\\").join("/")
}

function workspaceRelativePath(workspaceRoot: string, path: string): string {
  const relativePath = relative(workspaceRoot, resolve(workspaceRoot, path)).split(sep).join("/")
  return relativePath.length > 0 ? relativePath : "."
}

function isWorkspacePath(workspaceRoot: string, absolutePath: string): boolean {
  const relativePath = relative(workspaceRoot, absolutePath)
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
}

function uniqueScopePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)]
}

function sameScopePaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

function spawnGit(arguments_: readonly string[], workspaceRoot: string): FinalWaveGitCommandResult {
  const result = spawnSync("git", arguments_, { cwd: workspaceRoot, encoding: "utf-8", timeout: 5000, windowsHide: true })
  return { exitCode: result.status, stdout: result.stdout ?? "" }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected final-wave role: ${value}`)
}
