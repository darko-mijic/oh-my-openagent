import { afterEach, beforeEach, describe, expect, mock, test, afterAll } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import type { BoulderState } from "../../features/boulder-state"
import { clearBoulderState, writeBoulderState } from "../../features/boulder-state"
import { createFinalWaveTaskCompletion } from "./final-wave-mock-completion"
import {
  buildFinalWaveFixturePlan,
  createFinalWaveFixtureReceiptSidecar,
  writeFinalWaveFixturePlan,
} from "./final-wave-fixtures"
import { parseFinalWaveRoles } from "./final-wave-role-parser"
import { writeFinalWaveReceiptSidecar } from "./final-wave-receipt-test-support"

const TEST_STORAGE_ROOT = join(tmpdir(), `atlas-final-wave-regression-storage-${randomUUID()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE_ROOT, "message")
const TEST_PART_STORAGE = join(TEST_STORAGE_ROOT, "part")

mock.module("../../features/hook-message-injector/constants", () => ({
  OPENCODE_STORAGE: TEST_STORAGE_ROOT,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    const directoryPath = join(TEST_MESSAGE_STORAGE, sessionID)
    return existsSync(directoryPath) ? directoryPath : null
  },
}))

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
}))

afterAll(() => { mock.restore() })

const { createAtlasHook } = await import("./index")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

type AtlasHookContext = Parameters<typeof createAtlasHook>[0]

describe("Atlas final-wave approval gate regressions", () => {
  let testDirectory = ""

  function createMockPluginInput(): AtlasHookContext {
    const client = createOpencodeClient({ baseUrl: "http://localhost" })

    Reflect.set(client.session, "prompt", async () => ({
      data: { info: {} as AssistantMessage, parts: [] },
      request: new Request("http://localhost/session/prompt"),
      response: new Response(),
    }))

    Reflect.set(client.session, "promptAsync", async () => ({
      data: undefined,
      request: new Request("http://localhost/session/prompt_async"),
      response: new Response(),
    }))

    Reflect.set(client.session, "get", async ({ path }: { path: { id: string } }) => {
      const parentID = path.id === "ses_nested_scope_review"
        ? "atlas-nested-final-wave-session"
        : path.id.startsWith("ses_parallel_review_")
          ? "atlas-parallel-final-wave-session"
          : "main-session-123"

      return {
        data: {
          id: path.id,
          parentID,
        } as Session,
        request: new Request(`http://localhost/session/${path.id}`),
        response: new Response(),
      }
    })

    return {
      directory: testDirectory,
      project: {} as AtlasHookContext["project"],
      worktree: testDirectory,
      serverUrl: new URL("http://localhost"),
      $: {} as AtlasHookContext["$"],
      experimental_workspace: {} as AtlasHookContext["experimental_workspace"],
      client,
    }
  }

  function setupMessageStorage(sessionID: string): void {
    const messageDirectory = join(MESSAGE_STORAGE, sessionID)
    if (!existsSync(messageDirectory)) {
      mkdirSync(messageDirectory, { recursive: true })
    }

    writeFileSync(
      join(messageDirectory, "msg_test001.json"),
      JSON.stringify({
        agent: "atlas",
        model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      }),
    )
  }

  function writePlanState(sessionID: string, planName: string, planContent: string): void {
    const planPath = join(testDirectory, `${planName}.md`)
    writeFileSync(planPath, planContent)

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: planName,
      agent: "atlas",
    }

    writeBoulderState(testDirectory, state)
  }

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-final-wave-regression-${randomUUID()}`)
    mkdirSync(join(testDirectory, ".omo"), { recursive: true })
    clearBoulderState(testDirectory)
  })

  afterEach(() => {
    clearBoulderState(testDirectory)
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  test("builds marked and legacy final-wave fixture plans", () => {
    // given
    const markedPlan = buildFinalWaveFixturePlan({ variant: "marked-correct" })
    const legacyPlan = buildFinalWaveFixturePlan({ variant: "legacy-unmarked" })

    // when
    const markedRoles = parseFinalWaveRoles(markedPlan)
    const legacyRoles = parseFinalWaveRoles(legacyPlan)
    const markedCompletion = createFinalWaveTaskCompletion({
      fKey: "F1",
      variant: "marked-correct",
    })
    const wrongAgentCompletion = createFinalWaveTaskCompletion({
      fKey: "F1",
      variant: "marked-wrong-agent",
    })

    // then
    expect(markedRoles.status).toBe("marked")
    expect(markedRoles.rows.map((row) => row.role)).toEqual([
      "plan-auditor",
      "code-reviewer",
      "qa-executor",
      "scope-auditor",
    ])
    expect(legacyRoles.status).toBe("legacy-unmarked")
    expect(markedCompletion.toolOutput.metadata.agent).toBe("momus")
    expect(wrongAgentCompletion.toolOutput.metadata.agent).toBe("sisyphus-junior")
  })

  test("writes receipt sidecars in valid and corrupt fixture variants", () => {
    // given
    const validFixture = writeFinalWaveFixturePlan({
      workspaceRoot: testDirectory,
      slug: "valid-final-wave",
      variant: "marked-correct",
    })
    const corruptFixture = writeFinalWaveFixturePlan({
      workspaceRoot: testDirectory,
      slug: "corrupt-final-wave",
      variant: "corrupt-sidecar",
    })

    // when
    const validSidecarPath = writeFinalWaveReceiptSidecar({
      planPath: validFixture.planPath,
      sidecar: createFinalWaveFixtureReceiptSidecar(),
    })
    const validSidecar = JSON.parse(readFileSync(validSidecarPath, "utf-8"))
    const corruptSidecar = readFileSync(corruptFixture.receiptSidecarPath, "utf-8")

    // then
    expect(validSidecar).toHaveProperty("version", 1)
    expect(validSidecar).toHaveProperty("baseline.fRowContract.F3.role", "qa-executor")
    expect(validSidecar).toHaveProperty("expectations")
    expect(validSidecar).toHaveProperty("bindings")
    expect(validSidecar).toHaveProperty("receipts")
    expect(() => JSON.parse(corruptSidecar)).toThrow()
  })

  test("waits for approval when nested plan checkboxes remain but the only pending top-level task is final-wave", async () => {
    // given
    const sessionID = "atlas-nested-final-wave-session"
    setupMessageStorage(sessionID)
    writePlanState(sessionID, "nested-final-wave-plan", `# Plan

## TODOs
- [x] 1. Implement feature

  **Acceptance Criteria**:
  - [ ] bun test src/feature.test.ts -> PASS

  **Evidence to Capture**:
  - [ ] Each evidence file named: task-1-happy-path.txt

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. Plan compliance audit <!-- role:plan-auditor -->
- [x] F2. Code quality review <!-- role:code-reviewer -->
- [x] F3. Real manual QA <!-- role:qa-executor -->
- [ ] F4. Scope fidelity check <!-- role:scope-auditor -->

## Final Checklist
- [ ] All tests pass
`)

    const hook = createAtlasHook(createMockPluginInput(), {
      directory: testDirectory,
      isCallerOrchestrator: async () => true,
    })
    const { toolOutput } = createFinalWaveTaskCompletion({
      fKey: "F4",
      variant: "marked-correct",
      childSessionID: "ses_nested_scope_review",
    })

    // when
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)

    // then
    expect(toolOutput.output).toContain("FINAL WAVE APPROVAL GATE")
    expect(toolOutput.output).toContain("explicit user approval")
    expect(toolOutput.output).not.toContain("STEP 8: PROCEED TO NEXT TASK")
  })

  test("waits for approval after the final parallel reviewer approves before plan checkboxes are updated", async () => {
    // given
    const sessionID = "atlas-parallel-final-wave-session"
    setupMessageStorage(sessionID)
    writePlanState(sessionID, "parallel-final-wave-plan", `# Plan

## TODOs
- [x] 1. Ship implementation
- [x] 2. Verify implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->
- [ ] F2. Code quality review <!-- role:code-reviewer -->
- [ ] F3. Real manual QA <!-- role:qa-executor -->
- [ ] F4. Scope fidelity check <!-- role:scope-auditor -->
`)

    const hook = createAtlasHook(createMockPluginInput(), {
      directory: testDirectory,
      isCallerOrchestrator: async () => true,
    })
    const firstThreeOutputs = ["F1", "F2", "F3"] as const
    const firstThreeCompletions = firstThreeOutputs.map((fKey, index) => createFinalWaveTaskCompletion({
      fKey,
      variant: "marked-correct",
      childSessionID: `ses_parallel_review_${index + 1}`,
    }))
    const firstThreeToolOutputs = firstThreeCompletions.map((completion) => completion.toolOutput)
    const lastOutput = createFinalWaveTaskCompletion({
      fKey: "F4",
      variant: "marked-correct",
      childSessionID: "ses_parallel_review_4",
    }).toolOutput

    // when
    for (const toolOutput of firstThreeToolOutputs) {
      await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)
    }
    await hook["tool.execute.after"]({ tool: "task", sessionID }, lastOutput)

    // then
    for (const toolOutput of firstThreeToolOutputs) {
      expect(toolOutput.output).toContain("STEP 8: PROCEED TO NEXT TASK")
      expect(toolOutput.output).not.toContain("FINAL WAVE APPROVAL GATE")
    }
    expect(lastOutput.output).toContain("FINAL WAVE APPROVAL GATE")
    expect(lastOutput.output).toContain("explicit user approval")
    expect(lastOutput.output).not.toContain("STEP 8: PROCEED TO NEXT TASK")
  })
})
