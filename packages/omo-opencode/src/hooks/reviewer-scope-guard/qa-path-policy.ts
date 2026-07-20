import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, relative, resolve } from "node:path"

export type QaPathPolicy = {
  readonly isCreationTarget: (path: string) => boolean
  readonly isTestPath: (path: string) => boolean
  readonly isTrustedScript: (path: string) => boolean
  readonly isWritablePath: (path: string) => boolean
}

function isPathWithin(path: string, root: string): boolean {
  const relativePath = relative(root, path)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function canonicalizePath(path: string, base: string): string | undefined {
  const absolutePath = resolve(base, path)
  const missingSegments: string[] = []
  let existingAncestor = absolutePath

  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor)
    if (parent === existingAncestor) {
      return undefined
    }
    missingSegments.unshift(relative(parent, existingAncestor))
    existingAncestor = parent
  }

  try {
    return resolve(realpathSync.native(existingAncestor), ...missingSegments)
  } catch (error) {
    if (error instanceof Error) {
      return undefined
    }
    throw error
  }
}

function canonicalizeExistingPath(path: string, base: string): string | undefined {
  const absolutePath = resolve(base, path)
  if (!existsSync(absolutePath)) {
    return undefined
  }
  try {
    return realpathSync.native(absolutePath)
  } catch (error) {
    if (error instanceof Error) {
      return undefined
    }
    throw error
  }
}

export function createQaPathPolicy(projectRoot: string, worktree: string): QaPathPolicy {
  const canonicalProjectRoot = canonicalizePath(projectRoot, projectRoot)
  const canonicalWorktree = canonicalizePath(worktree, worktree)
  const canonicalTempRoot = canonicalizePath(tmpdir(), tmpdir())
  if (canonicalProjectRoot === undefined || canonicalWorktree === undefined || canonicalTempRoot === undefined) {
    return {
      isCreationTarget: () => false,
      isTestPath: () => false,
      isTrustedScript: () => false,
      isWritablePath: () => false,
    }
  }

  const canonicalEvidenceRoot = canonicalizePath(resolve(canonicalProjectRoot, ".omo", "evidence"), canonicalProjectRoot)
  const worktreeOmoEvidenceRoot = canonicalizePath(resolve(canonicalWorktree, ".omo", "evidence"), canonicalWorktree)
  const worktreeEvidenceRoot = canonicalizePath(resolve(canonicalWorktree, "evidence"), canonicalWorktree)

  return {
    isCreationTarget: (path): boolean => {
      const target = canonicalizePath(path, canonicalWorktree)
      return target !== undefined && (
        isPathWithin(target, canonicalTempRoot)
        || isPathWithin(target, canonicalWorktree)
        || (canonicalEvidenceRoot !== undefined && isPathWithin(target, canonicalEvidenceRoot))
      )
    },
    isTestPath: (path): boolean => {
      if (path.startsWith("-")) {
        return true
      }
      const target = resolve(canonicalWorktree, path)
      return isPathWithin(target, canonicalWorktree) || isPathWithin(target, canonicalProjectRoot)
    },
    isTrustedScript: (path): boolean => {
      if (path.startsWith("-")) {
        return false
      }
      const target = canonicalizeExistingPath(path, canonicalWorktree)
      return target !== undefined && (
        isPathWithin(target, canonicalWorktree)
        || isPathWithin(target, canonicalProjectRoot)
      )
    },
    isWritablePath: (path): boolean => {
      const target = canonicalizePath(path, canonicalWorktree)
      if (target === undefined) {
        return false
      }
      // Worktrees often live under OS temp (tests, disposable checkouts). Temp
      // allowance must not reopen product writes; canonical project evidence is
      // separately writable when the session worktree is elsewhere.
      const isOutsideWorktreeTemp = isPathWithin(target, canonicalTempRoot)
        && !isPathWithin(target, canonicalWorktree)
      return (canonicalEvidenceRoot !== undefined && isPathWithin(target, canonicalEvidenceRoot))
        || (worktreeOmoEvidenceRoot !== undefined && isPathWithin(target, worktreeOmoEvidenceRoot))
        || (worktreeEvidenceRoot !== undefined && isPathWithin(target, worktreeEvidenceRoot))
        || isOutsideWorktreeTemp
    },
  }
}
