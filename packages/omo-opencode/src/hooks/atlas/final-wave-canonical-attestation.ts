import { spawnSync } from "node:child_process"
import { relative, resolve, sep } from "node:path"

export type FinalWaveGitCommandResult = {
  readonly exitCode: number | null
  readonly stdout: string
}

export type FinalWaveGitSpawn = (
  arguments_: readonly string[],
  workspaceRoot: string,
) => FinalWaveGitCommandResult

export function attestCanonicalTreeClean(input: {
  readonly workspaceRoot: string
  readonly planPath: string
  readonly baselineGitHead: string | "nogit"
  readonly spawnGit?: FinalWaveGitSpawn
}): { readonly ok: true } | { readonly ok: false; readonly dirtyPaths: readonly string[] } {
  if (input.baselineGitHead === "nogit") {
    return { ok: true }
  }

  const spawn = input.spawnGit ?? spawnGit
  const status = spawn(["status", "--porcelain", "-uall"], input.workspaceRoot)
  if (status.exitCode !== 0) {
    return { ok: false, dirtyPaths: ["(git-status-failed)"] }
  }

  const planRelative = workspaceRelativePath(input.workspaceRoot, input.planPath)
  const dirtyPaths = parsePorcelainPaths(status.stdout).filter((path) => !isExcludedFromAttestation(path, planRelative))
  return dirtyPaths.length === 0 ? { ok: true } : { ok: false, dirtyPaths }
}

function isExcludedFromAttestation(path: string, planRelative: string): boolean {
  if (path === planRelative) return true
  return isOmoWorkspacePath(path)
}

export function isOmoWorkspacePath(path: string): boolean {
  return path === ".omo" || path.startsWith(".omo/")
}

export function parsePorcelainPaths(stdout: string): readonly string[] {
  const paths: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 4) continue
    const payload = line.slice(3)
    const renameSeparator = payload.indexOf(" -> ")
    const rawPath = renameSeparator >= 0 ? payload.slice(renameSeparator + 4) : payload
    const normalized = rawPath.replace(/^"|"$/g, "").split(sep).join("/")
    if (normalized.length > 0) paths.push(normalized)
  }
  return paths
}

function workspaceRelativePath(workspaceRoot: string, path: string): string {
  const relativePath = relative(resolve(workspaceRoot), resolve(path)).split(sep).join("/")
  return relativePath.length > 0 ? relativePath : "."
}

function spawnGit(arguments_: readonly string[], workspaceRoot: string): FinalWaveGitCommandResult {
  const result = spawnSync("git", arguments_, {
    cwd: workspaceRoot,
    encoding: "utf-8",
    timeout: 5000,
    windowsHide: true,
  })
  return { exitCode: result.status, stdout: result.stdout ?? "" }
}
