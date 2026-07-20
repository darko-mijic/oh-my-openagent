import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { clearSessionAgent, setSessionAgent } from "../features/claude-code-session-state"
import { createReviewerScopeGuardHook } from "../hooks/reviewer-scope-guard"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { CreatedHooks } from "../create-hooks"
import type { PluginContext } from "./types"

const SESSION_ID = "ses_reviewer_scope_dispatch"
const temporaryDirectories: string[] = []

function createWorktree(): string {
  const worktree = mkdtempSync(join(tmpdir(), "reviewer-scope-dispatch-"))
  temporaryDirectories.push(worktree)
  return worktree
}

function createContext(worktree: string): PluginContext {
  return unsafeTestValue<PluginContext>({
    directory: worktree,
    client: {
      session: {
        get: async () => ({ data: { directory: worktree } }),
        messages: async () => ({ data: [] }),
      },
    },
  })
}

function createHooks(worktree: string): CreatedHooks {
  return unsafeTestValue<CreatedHooks>({
    reviewerScopeGuard: createReviewerScopeGuardHook(createContext(worktree)),
  })
}

async function runTool(args: {
  readonly agent: string
  readonly worktree: string
  readonly tool: string
  readonly toolArgs: Record<string, unknown>
}): Promise<void> {
  setSessionAgent(SESSION_ID, args.agent)
  const handler = createToolExecuteBeforeHandler({
    ctx: createContext(args.worktree),
    hooks: createHooks(args.worktree),
  })

  await handler(
    { tool: args.tool, sessionID: SESSION_ID, callID: "call_reviewer_scope" },
    { args: args.toolArgs },
  )
}

afterEach(() => {
  clearSessionAgent(SESSION_ID)
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("tool.execute.before reviewer-scope-guard dispatch", () => {
  test("#given momus #when Write targets product source #then dispatcher rejects", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = runTool({
      agent: "momus",
      worktree,
      tool: "Write",
      toolArgs: { filePath: join(worktree, "src", "index.ts") },
    })

    // then
    await expect(result).rejects.toThrow("read-only reviewer")
  })

  test("#given oracle #when Bash chains a mutation #then dispatcher rejects", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = runTool({
      agent: "oracle",
      worktree,
      tool: "Bash",
      toolArgs: { command: "git status; tee evidence.txt" },
    })

    // then
    await expect(result).rejects.toThrow("read-only grammar")
  })

  test("#given qa-executor #when Write targets .omo/evidence #then dispatcher allows", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = runTool({
      agent: "qa-executor",
      worktree,
      tool: "Write",
      toolArgs: { filePath: join(worktree, ".omo", "evidence", "20260720-f2", "result.md") },
    })

    // then
    await expect(result).resolves.toBeUndefined()
  })

  test("#given qa-executor #when Write targets product source under worktree #then dispatcher rejects", async () => {
    // given
    const worktree = createWorktree()

    // when
    const result = runTool({
      agent: "qa-executor",
      worktree,
      tool: "Write",
      toolArgs: { filePath: join(worktree, "packages", "omo-opencode", "src", "index.ts") },
    })

    // then
    await expect(result).rejects.toThrow(".omo/evidence/**, worktree evidence/**, or OS temp")
  })
})
