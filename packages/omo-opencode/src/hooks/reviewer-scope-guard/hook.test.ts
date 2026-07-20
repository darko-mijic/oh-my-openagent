import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
import { createReviewerScopeGuardHook } from "./hook"

const SESSION_ID = "reviewer-scope-guard-session"
const temporaryDirectories: string[] = []

function createHook(projectRoot: string, worktree: string) {
  return createReviewerScopeGuardHook({
    directory: projectRoot,
    client: {
      session: {
        get: async () => ({ data: { directory: worktree } }),
      },
    },
  } as never)
}

async function invoke(args: {
  readonly agent: string
  readonly projectRoot?: string
  readonly worktree: string
  readonly tool: string
  readonly toolArgs: Record<string, unknown>
}): Promise<void> {
  setSessionAgent(SESSION_ID, args.agent)
  const hook = createHook(args.projectRoot ?? args.worktree, args.worktree)
  await hook["tool.execute.before"]?.(
    { tool: args.tool, sessionID: SESSION_ID, callID: "call-1" },
    { args: args.toolArgs },
  )
}

function createWorktree(): string {
  const worktree = mkdtempSync(join(tmpdir(), "reviewer-scope-guard-"))
  temporaryDirectories.push(worktree)
  return worktree
}

function createProjectRoot(): string {
  const projectRoot = mkdtempSync(join(process.cwd(), ".reviewer-scope-project-"))
  temporaryDirectories.push(projectRoot)
  return projectRoot
}

afterEach(() => {
  clearSessionAgent(SESSION_ID)
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("createReviewerScopeGuardHook", () => {
  test("#given Momus #when Write executes #then denies the product write", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = invoke({
      agent: "momus",
      worktree,
      tool: "Write",
      toolArgs: { filePath: join(worktree, "src", "index.ts") },
    })

    // then
    await expect(result).rejects.toThrow("read-only reviewer")
  })

  test("#given Oracle #when a chained Bash command executes #then denies the mutation bypass", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = invoke({
      agent: "oracle",
      worktree,
      tool: "Bash",
      toolArgs: { command: "git status; tee evidence.txt" },
    })

    // then
    await expect(result).rejects.toThrow("read-only grammar")
  })

  test("#given Oracle #when git diff executes #then allows a read-only command", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = invoke({
      agent: "oracle",
      worktree,
      tool: "Bash",
      toolArgs: { command: "git diff --stat" },
    })

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("#given qa-executor #when writing under .omo/evidence #then allows the write", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = invoke({
      agent: "qa-executor",
      worktree,
      tool: "Edit",
      toolArgs: { filePath: join(worktree, ".omo", "evidence", "20260720-qa", "result.md") },
    })

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("#given a canonical project separate from the disposable worktree #when qa-executor writes project evidence #then allows the write", async () => {
    // given
    const projectRoot = createProjectRoot()
    const worktree = createWorktree()

    // when
    const result = invoke({
      agent: "qa-executor",
      projectRoot,
      worktree,
      tool: "Write",
      toolArgs: { filePath: join(projectRoot, ".omo", "evidence", "20260719-f3", "README.md") },
    })

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("#given canonical evidence contains a symlink to product source #when qa-executor writes through it #then denies the escape", async () => {
    // given
    const projectRoot = createProjectRoot()
    const worktree = createWorktree()
    const productRoot = join(projectRoot, "packages")
    const evidenceRoot = join(projectRoot, ".omo", "evidence")
    mkdirSync(productRoot, { recursive: true })
    mkdirSync(evidenceRoot, { recursive: true })
    symlinkSync(productRoot, join(evidenceRoot, "escaped"))

    // when
    const result = invoke({
      agent: "qa-executor",
      projectRoot,
      worktree,
      tool: "Write",
      toolArgs: { filePath: join(evidenceRoot, "escaped", "index.ts") },
    })

    // then
    await expect(result).rejects.toThrow(".omo/evidence/**, worktree evidence/**, or OS temp")
  })

  test("#given qa-executor #when writing under worktree evidence/ #then allows the write", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = invoke({
      agent: "qa-executor",
      worktree,
      tool: "Write",
      toolArgs: { filePath: join(worktree, "evidence", "manual-qa", "result.md") },
    })

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("#given qa-executor #when writing OS temp evidence #then allows the write", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = invoke({
      agent: "qa-executor",
      worktree,
      tool: "Write",
      toolArgs: { filePath: join(tmpdir(), "reviewer-scope-guard-temp", "result.md") },
    })

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("#given qa-executor #when writing a product file under the worktree #then denies the write", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = invoke({
      agent: "qa-executor",
      worktree,
      tool: "Write",
      toolArgs: { filePath: join(worktree, "src", "index.ts") },
    })

    // then
    await expect(result).rejects.toThrow(".omo/evidence/**, worktree evidence/**, or OS temp")
  })

  test("#given qa-executor #when writing outside evidence and temp roots #then denies the write", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = invoke({
      agent: "qa-executor",
      worktree,
      tool: "hashline_edit",
      toolArgs: { filePath: resolve(tmpdir(), "..", "reviewer-scope-guard-outside", "src", "index.ts") },
    })

    // then
    await expect(result).rejects.toThrow(".omo/evidence/**, worktree evidence/**, or OS temp")
  })

  test("#given qa-executor #when node test targets its worktree #then allows the QA command", async () => {
    // given
    const worktree = createWorktree()
    mkdirSync(join(worktree, "test"), { recursive: true })
    writeFileSync(join(worktree, "test", "qa.test.mjs"), "")

    // when
    const result = invoke({
      agent: "qa-executor",
      worktree,
      tool: "Bash",
      toolArgs: { command: `node --test ${join(worktree, "test", "qa.test.mjs")}` },
    })

    // then
    await expect(result).resolves.toBeUndefined()
  })

  for (const command of [
    "node -e \"process.exit(0)\"",
    "bun -e \"process.exit(0)\"",
    "tee evidence.txt",
    "sed -i s/old/new/ file.txt",
    "git apply patch.diff",
  ]) {
    test(`#given qa-executor #when Bash runs ${command.split(" ")[0]} bypass #then denies`, async () => {
      // given
      const worktree = createWorktree()

      // when
      const result = invoke({
        agent: "qa-executor",
        worktree,
        tool: "Bash",
        toolArgs: { command },
      })

      // then
      await expect(result).rejects.toThrow("QA allowlist")
    })
  }
})
