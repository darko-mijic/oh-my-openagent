import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { PluginInput } from "@opencode-ai/plugin"
import { writeBoulderState, clearBoulderState } from "../../features/boulder-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { buildFinalWaveFixturePlan, FINAL_WAVE_FIXTURE_ROWS } from "./final-wave-fixtures"
import { readReceiptStore } from "./final-wave-receipts"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { PendingTaskRef } from "./types"

const testDirectories: string[] = []

function createWorkspace(): string {
  const directory = join(tmpdir(), `atlas-before-fwave-${randomUUID()}`)
  testDirectories.push(directory)
  mkdirSync(join(directory, ".omo", "plans"), { recursive: true })
  return directory
}

function createCtx(directory: string): PluginInput {
  return unsafeTestValue<PluginInput>({
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost"),
    client: {},
    $: Bun.$,
  })
}

function writeMarkedPlan(directory: string, variant: "marked-correct" | "legacy-unmarked" = "marked-correct"): string {
  const planPath = join(directory, ".omo", "plans", "wave.md")
  writeFileSync(planPath, buildFinalWaveFixturePlan({ variant }))
  writeBoulderState(directory, {
    active_plan: planPath,
    started_at: "2026-07-20T00:00:00Z",
    session_ids: ["session-1"],
    plan_name: "wave",
  })
  return planPath
}

function f2Prompt(): string {
  const row = FINAL_WAVE_FIXTURE_ROWS.F2
  return [
    "## 1. TASK",
    `${row.fKey}. ${row.title}`,
    "",
    "Audit the implementation.",
  ].join("\n")
}

function nonEchoingPrompt(): string {
  return [
    "## 1. TASK",
    "Review the final wave without echoing the F-row line",
    "",
    "Do the review.",
  ].join("\n")
}

function todoPrompt(): string {
  return [
    "## 1. TASK",
    "1. Implement auth flow",
    "",
    "Ship it.",
  ].join("\n")
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    clearBoulderState(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("tool-execute-before final-wave launch authorization", () => {
  test("#given a marked F2 launch with the bound subagent #when before-hook runs #then it stays silent and persists the expectation", async () => {
    // given
    const directory = createWorkspace()
    const planPath = writeMarkedPlan(directory)
    const pendingTaskRefs = new Map<string, PendingTaskRef>()
    const handler = createToolExecuteBeforeHandler({
      ctx: createCtx(directory),
      pendingFilePaths: new Map(),
      pendingTaskRefs,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      args: {
        prompt: f2Prompt(),
        subagent_type: "oracle",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    await handler({ tool: "task", sessionID: "ses_atlas", callID: "call-f2-ok" }, toolOutput)

    // then
    expect(toolOutput.message ?? "").not.toContain("final-wave-named-reviewer-advisory")
    const pending = pendingTaskRefs.get("call-f2-ok")
    expect(pending?.kind).toBe("track")
    if (pending?.kind !== "track") throw new Error("expected track ref")
    expect(pending.task.expectedRole).toBe("code-reviewer")
    expect(pending.task.expectedSubagent).toBe("oracle")
    expect(typeof pending.task.launchId).toBe("string")
    expect(pending.task.launchId?.length).toBeGreaterThan(0)

    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations.F2?.role).toBe("code-reviewer")
    expect(store.expectations.F2?.subagent).toBe("oracle")
    expect(store.expectations.F2?.launchId).toBe(pending.task.launchId)
    expect(existsSync(planPath.replace(/\.md$/, ".receipts.json"))).toBe(true)
  })

  test("#given a marked F2 launch routed by category #when before-hook runs #then it warns advisories and still persists the expectation", async () => {
    // given
    const directory = createWorkspace()
    const planPath = writeMarkedPlan(directory)
    const pendingTaskRefs = new Map<string, PendingTaskRef>()
    const handler = createToolExecuteBeforeHandler({
      ctx: createCtx(directory),
      pendingFilePaths: new Map(),
      pendingTaskRefs,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      args: {
        prompt: f2Prompt(),
        category: "unspecified-high",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    await handler({ tool: "task", sessionID: "ses_atlas", callID: "call-f2-category" }, toolOutput)

    // then
    expect(toolOutput.message).toContain("final-wave-named-reviewer-advisory")
    expect(toolOutput.message).toContain('subagent_type="oracle"')
    expect(toolOutput.message).toContain('category="unspecified-high"')
    const pending = pendingTaskRefs.get("call-f2-category")
    expect(pending?.kind).toBe("track")
    if (pending?.kind !== "track") throw new Error("expected track ref")
    expect(pending.task.expectedSubagent).toBe("oracle")
    expect(pending.task.launchId).toBeDefined()

    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations.F2?.launchId).toBe(pending.task.launchId)
  })

  test("#given a marked F2 launch with the wrong subagent #when before-hook runs #then it warns and persists the expectation", async () => {
    // given
    const directory = createWorkspace()
    const planPath = writeMarkedPlan(directory)
    const pendingTaskRefs = new Map<string, PendingTaskRef>()
    const handler = createToolExecuteBeforeHandler({
      ctx: createCtx(directory),
      pendingFilePaths: new Map(),
      pendingTaskRefs,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      args: {
        prompt: f2Prompt(),
        subagent_type: "sisyphus-junior",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    await handler({ tool: "task", sessionID: "ses_atlas", callID: "call-f2-wrong" }, toolOutput)

    // then
    expect(toolOutput.message).toContain("final-wave-named-reviewer-advisory")
    expect(toolOutput.message).toContain('subagent_type="sisyphus-junior"')
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations.F2?.subagent).toBe("oracle")
  })

  test("#given a marked F2 launch with no subagent_type #when before-hook runs #then it warns and persists the expectation", async () => {
    // given
    const directory = createWorkspace()
    const planPath = writeMarkedPlan(directory)
    const pendingTaskRefs = new Map<string, PendingTaskRef>()
    const handler = createToolExecuteBeforeHandler({
      ctx: createCtx(directory),
      pendingFilePaths: new Map(),
      pendingTaskRefs,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      args: {
        prompt: f2Prompt(),
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    await handler({ tool: "task", sessionID: "ses_atlas", callID: "call-f2-absent" }, toolOutput)

    // then
    expect(toolOutput.message).toContain("final-wave-named-reviewer-advisory")
    expect(toolOutput.message).toContain("no subagent_type")
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations.F2?.subagent).toBe("oracle")
  })

  test("#given a non-echoing launch while the current task is an F-row #when before-hook runs #then it records no expectation", async () => {
    // given
    const directory = createWorkspace()
    const planPath = writeMarkedPlan(directory)
    const pendingTaskRefs = new Map<string, PendingTaskRef>()
    const handler = createToolExecuteBeforeHandler({
      ctx: createCtx(directory),
      pendingFilePaths: new Map(),
      pendingTaskRefs,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      args: {
        prompt: nonEchoingPrompt(),
        subagent_type: "oracle",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    await handler({ tool: "task", sessionID: "ses_atlas", callID: "call-no-echo" }, toolOutput)

    // then
    expect(toolOutput.message ?? "").not.toContain("final-wave-named-reviewer-advisory")
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations).toEqual({})
    expect(store.baseline).toBeNull()
    expect(existsSync(planPath.replace(/\.md$/, ".receipts.json"))).toBe(false)
  })

  test("#given a legacy-unmarked plan F-row echo #when before-hook runs #then behavior is unchanged and no expectation is written", async () => {
    // given
    const directory = createWorkspace()
    const planPath = writeMarkedPlan(directory, "legacy-unmarked")
    const pendingTaskRefs = new Map<string, PendingTaskRef>()
    const handler = createToolExecuteBeforeHandler({
      ctx: createCtx(directory),
      pendingFilePaths: new Map(),
      pendingTaskRefs,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      args: {
        prompt: f2Prompt(),
        category: "unspecified-high",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    await handler({ tool: "task", sessionID: "ses_atlas", callID: "call-legacy" }, toolOutput)

    // then
    expect(toolOutput.message ?? "").not.toContain("final-wave-named-reviewer-advisory")
    const pending = pendingTaskRefs.get("call-legacy")
    expect(pending?.kind).toBe("track")
    if (pending?.kind !== "track") throw new Error("expected track ref")
    expect(pending.task.expectedRole).toBeUndefined()
    expect(pending.task.launchId).toBeUndefined()
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations).toEqual({})
    expect(existsSync(planPath.replace(/\.md$/, ".receipts.json"))).toBe(false)
  })

  test("#given an enforced git workspace category F launch #when before-hook runs #then it hard-rejects without tracking", async () => {
    // given
    const directory = createWorkspace()
    spawnSync("git", ["init"], { cwd: directory, encoding: "utf-8" })
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: directory, encoding: "utf-8" })
    spawnSync("git", ["config", "user.name", "Test"], { cwd: directory, encoding: "utf-8" })
    writeFileSync(join(directory, "README.md"), "x\n")
    spawnSync("git", ["add", "README.md"], { cwd: directory, encoding: "utf-8" })
    spawnSync("git", ["commit", "-m", "init"], { cwd: directory, encoding: "utf-8" })
    const planPath = writeMarkedPlan(directory)
    const pendingTaskRefs = new Map<string, PendingTaskRef>()
    const handler = createToolExecuteBeforeHandler({
      ctx: createCtx(directory),
      pendingFilePaths: new Map(),
      pendingTaskRefs,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      args: {
        prompt: f2Prompt(),
        category: "unspecified-high",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when / then
    await expect(
      handler({ tool: "task", sessionID: "ses_atlas", callID: "call-f2-enforced-reject" }, toolOutput),
    ).rejects.toThrow("REJECTED")
    expect(toolOutput.message).toContain("final-wave-named-reviewer-rejection")
    expect(pendingTaskRefs.has("call-f2-enforced-reject")).toBe(false)
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations.F2).toBeUndefined()
  })

  test("#given a non-F todo launch #when before-hook runs #then final-wave authorization is skipped", async () => {
    // given
    const directory = createWorkspace()
    const planPath = join(directory, ".omo", "plans", "impl.md")
    writeFileSync(planPath, `# Plan\n\n## TODOs\n- [ ] 1. Implement auth flow\n`)
    writeBoulderState(directory, {
      active_plan: planPath,
      started_at: "2026-07-20T00:00:00Z",
      session_ids: ["session-1"],
      plan_name: "impl",
    })
    const pendingTaskRefs = new Map<string, PendingTaskRef>()
    const handler = createToolExecuteBeforeHandler({
      ctx: createCtx(directory),
      pendingFilePaths: new Map(),
      pendingTaskRefs,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      args: {
        prompt: todoPrompt(),
        category: "quick",
      } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    await handler({ tool: "task", sessionID: "ses_atlas", callID: "call-todo" }, toolOutput)

    // then
    expect(toolOutput.message ?? "").not.toContain("final-wave-named-reviewer-advisory")
    const pending = pendingTaskRefs.get("call-todo")
    expect(pending).toEqual({
      kind: "track",
      task: {
        key: "todo:1",
        section: "todo",
        label: "1",
        title: "Implement auth flow",
      },
    })
    expect(existsSync(planPath.replace(/\.md$/, ".receipts.json"))).toBe(false)
  })
})
