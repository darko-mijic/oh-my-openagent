import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { clearBoulderState, writeBoulderState } from "../../features/boulder-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { buildFinalWaveFixturePlan, FINAL_WAVE_FIXTURE_ROWS } from "./final-wave-fixtures"
import { readReceiptStore } from "./final-wave-receipts"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { PendingTaskRef } from "./types"

const testDirectories: string[] = []

function createWorkspace(): string {
  const directory = join(tmpdir(), `atlas-before-work-scope-${randomUUID()}`)
  testDirectories.push(directory)
  mkdirSync(join(directory, ".omo", "plans"), { recursive: true })
  return directory
}

function initializeGit(directory: string): void {
  spawnSync("git", ["init"], { cwd: directory, encoding: "utf-8" })
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: directory, encoding: "utf-8" })
  spawnSync("git", ["config", "user.name", "Test"], { cwd: directory, encoding: "utf-8" })
  writeFileSync(join(directory, "README.md"), "x\n")
  spawnSync("git", ["add", "README.md"], { cwd: directory, encoding: "utf-8" })
  spawnSync("git", ["commit", "-m", "init"], { cwd: directory, encoding: "utf-8" })
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

function f2Prompt(): string {
  const row = FINAL_WAVE_FIXTURE_ROWS.F2
  return ["## 1. TASK", `${row.fKey}. ${row.title}`, "", "Audit the implementation."].join("\n")
}

async function createPendingF2Scenario(initGitWorkspace: boolean): Promise<{
  readonly planPath: string
  readonly pendingTaskRefs: Map<string, PendingTaskRef>
  readonly handler: ReturnType<typeof createToolExecuteBeforeHandler>
  readonly firstLaunchId: string
}> {
  const directory = createWorkspace()
  if (initGitWorkspace) initializeGit(directory)
  const planPath = join(directory, ".omo", "plans", "wave.md")
  writeFileSync(planPath, buildFinalWaveFixturePlan({ variant: "marked-correct" }))
  writeBoulderState(directory, {
    active_plan: planPath,
    started_at: "2026-07-20T00:00:00Z",
    session_ids: ["session-1"],
    plan_name: "wave",
  })
  const pendingTaskRefs = new Map<string, PendingTaskRef>()
  const handler = createToolExecuteBeforeHandler({
    ctx: createCtx(directory),
    pendingFilePaths: new Map(),
    pendingTaskRefs,
    isCallerOrchestrator: async () => true,
  })
  await handler(
    { tool: "task", sessionID: "ses_atlas", callID: "call-f2-first" },
    { args: { prompt: f2Prompt(), subagent_type: "oracle" } },
  )
  const firstPending = pendingTaskRefs.get("call-f2-first")
  if (firstPending?.kind !== "track" || firstPending.task.launchId === undefined) {
    throw new Error("expected initial tracked launch")
  }
  return { planPath, pendingTaskRefs, handler, firstLaunchId: firstPending.task.launchId }
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    clearBoulderState(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("tool-execute-before work-scoped final-wave launches", () => {
  test("#given concurrent works with a marked session-bound plan and legacy global plan #when an F2 launch runs #then it persists its expectation only beside the marked work plan", async () => {
    // given
    const directory = createWorkspace()
    initializeGit(directory)
    const legacyPlanPath = join(directory, ".omo", "plans", "legacy-global.md")
    const markedPlanPath = join(directory, ".omo", "plans", "marked-work.md")
    writeFileSync(legacyPlanPath, buildFinalWaveFixturePlan({ variant: "legacy-unmarked" }))
    writeFileSync(markedPlanPath, buildFinalWaveFixturePlan({ variant: "marked-correct" }))
    writeBoulderState(directory, {
      schema_version: 2,
      active_work_id: "legacy-global",
      active_plan: legacyPlanPath,
      started_at: "2026-07-20T00:00:00Z",
      session_ids: ["ses_legacy"],
      plan_name: "legacy-global",
      works: {
        "legacy-global": {
          work_id: "legacy-global",
          active_plan: legacyPlanPath,
          plan_name: "legacy-global",
          started_at: "2026-07-20T00:00:00Z",
          session_ids: ["ses_legacy"],
          status: "active",
        },
        "marked-work": {
          work_id: "marked-work",
          active_plan: markedPlanPath,
          plan_name: "marked-work",
          started_at: "2026-07-20T00:01:00Z",
          session_ids: ["ses_marked"],
          status: "active",
        },
      },
    })
    const pendingTaskRefs = new Map<string, PendingTaskRef>()
    const handler = createToolExecuteBeforeHandler({
      ctx: createCtx(directory),
      pendingFilePaths: new Map(),
      pendingTaskRefs,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      args: { prompt: f2Prompt(), subagent_type: "oracle" } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    await handler({ tool: "task", sessionID: "ses_marked", callID: "call-marked-work-f2" }, toolOutput)

    // then
    const pending = pendingTaskRefs.get("call-marked-work-f2")
    if (pending?.kind !== "track") throw new Error("expected track ref")
    if (pending.task.launchId === undefined) throw new Error("expected launch id")
    const markedStore = readReceiptStore(markedPlanPath)
    if ("corrupt" in markedStore) throw new Error("expected valid marked receipt store")
    expect(markedStore.expectations.F2?.launchId).toBe(pending.task.launchId)
    expect(existsSync(markedPlanPath.replace(/\.md$/, ".receipts.json"))).toBe(true)
    expect(existsSync(legacyPlanPath.replace(/\.md$/, ".receipts.json"))).toBe(false)
  })

  test("#given a pending F2 claim under enforcement #when a duplicate category-routed F2 launch runs #then it hard-rejects instead of being classified as ambiguous", async () => {
    // given
    const { handler, pendingTaskRefs, planPath, firstLaunchId } = await createPendingF2Scenario(true)
    const duplicateOutput = {
      args: { prompt: f2Prompt(), category: "unspecified-high" } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    const rejection = await handler(
      { tool: "task", sessionID: "ses_atlas", callID: "call-f2-duplicate-category" },
      duplicateOutput,
    ).then(
      () => {
        throw new Error("expected duplicate rejection")
      },
      (error: unknown) => {
        if (error instanceof Error) return error
        throw error
      },
    )

    // then
    expect(rejection.message).toContain("REJECTED")
    expect(duplicateOutput.message).toContain("final-wave-named-reviewer-rejection")
    expect(pendingTaskRefs.get("call-f2-duplicate-category")).toBeUndefined()
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations.F2?.launchId).toBe(firstLaunchId)
  })

  test("#given a pending F2 claim under advisory mode #when a duplicate category-routed F2 launch runs #then it warns before preserving the ambiguous retry classification", async () => {
    // given
    const { handler, pendingTaskRefs, planPath, firstLaunchId } = await createPendingF2Scenario(false)
    const duplicateOutput = {
      args: { prompt: f2Prompt(), category: "unspecified-high" } as Record<string, unknown>,
      message: undefined as string | undefined,
    }

    // when
    await handler(
      { tool: "task", sessionID: "ses_atlas", callID: "call-f2-advisory-category" },
      duplicateOutput,
    )

    // then
    expect(duplicateOutput.message).toContain("final-wave-named-reviewer-advisory")
    expect(pendingTaskRefs.get("call-f2-advisory-category")).toEqual({
      kind: "skip",
      reason: "ambiguous_task_key",
      task: expect.objectContaining({ key: "final-wave:f2" }),
    })
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations.F2?.launchId).toBe(firstLaunchId)
  })

  test("#given a pending F2 claim #when the bound subagent retries F2 #then it remains an ambiguous retry without replacing the launch expectation", async () => {
    // given
    const { handler, pendingTaskRefs, planPath, firstLaunchId } = await createPendingF2Scenario(true)

    // when
    await handler(
      { tool: "task", sessionID: "ses_atlas", callID: "call-f2-bound-retry" },
      { args: { prompt: f2Prompt(), subagent_type: "oracle" } },
    )

    // then
    expect(pendingTaskRefs.get("call-f2-bound-retry")).toEqual({
      kind: "skip",
      reason: "ambiguous_task_key",
      task: expect.objectContaining({ key: "final-wave:f2" }),
    })
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid receipt store")
    expect(store.expectations.F2?.launchId).toBe(firstLaunchId)
  })
})
