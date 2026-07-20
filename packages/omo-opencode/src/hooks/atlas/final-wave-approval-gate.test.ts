import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import type { BoulderState } from "../../features/boulder-state"
import { clearBoulderState, writeBoulderState } from "../../features/boulder-state"
import { classifyFinalWaveVerdict, stripVerdictContext } from "./final-wave-approval-gate"
import {
  processFinalWaveAdvisoryCompletion,
  resolveFinalWaveActualAgent,
} from "./final-wave-completion-verification"
import { writeFinalWaveFixturePlan } from "./final-wave-fixtures"
import { createFinalWaveTaskCompletion } from "./final-wave-mock-completion"
import {
  readReceiptStore,
  recordLaunchExpectation,
  writeFinalWaveReceiptStore,
} from "./final-wave-receipts"
import { createAtlasHook } from "./index"
import type { PendingTaskRef } from "./types"

type AtlasHookContext = Parameters<typeof createAtlasHook>[0]
type PromptMock = ReturnType<typeof mock>

describe("classifyFinalWaveVerdict", () => {
  test("returns approve when the output carries a line-anchored APPROVE verdict", () => {
    // given
    const output = "Tasks [4/4 compliant]\nVERDICT: APPROVE"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("approve")
  })

  test("returns reject when the output carries a line-anchored REJECT verdict", () => {
    // given
    const output = "Tasks [2/4 compliant]\nVERDICT: REJECT"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("reject")
  })

  test("returns missing when the output has no verdict token", () => {
    // given
    const output = "Implementation finished successfully with all checks green"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })

  test("returns missing when the output ends on a bash call with no verdict", () => {
    // given
    const output = `Ran the test suite

\`\`\`bash
bun test packages/omo-opencode/src/hooks/atlas/final-wave-approval-gate.test.ts
\`\`\``

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })

  test("matches the approve verdict case-insensitively", () => {
    // given
    const output = "summary line\nverdict: approve"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("approve")
  })

  test("matches the reject verdict case-insensitively", () => {
    // given
    const output = "summary line\nVeRdIcT: ReJeCt"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("reject")
  })

  test("returns the last line-anchored verdict when approve and reject both appear", () => {
    // given
    const output = "VERDICT: REJECT\nrevised after fixes\nVERDICT: APPROVE"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("approve")
  })

  test("returns missing for mid-line negated verdict text", () => {
    // given
    const output = "I would not VERDICT: APPROVE this change"

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })

  test("returns missing when the output only repeats the verdict instruction mid-line", () => {
    // given
    const output = "Please emit VERDICT: APPROVE or VERDICT: REJECT before finishing."

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })

  test("ignores fenced verdict decoys", () => {
    // given
    const output = `Review notes

\`\`\`md
VERDICT: APPROVE
\`\`\`

Still incomplete.`

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })

  test("ignores blockquoted verdict decoys", () => {
    // given
    const output = `Notes
> VERDICT: APPROVE
Still incomplete.`

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("missing")
  })

  test("resolves mixed streams by the last anchored verdict outside fences", () => {
    // given
    const output = `Intro
\`\`\`
VERDICT: REJECT
\`\`\`
> VERDICT: REJECT
VERDICT: REJECT
after remediation
VERDICT: APPROVE`

    // when
    const verdict = classifyFinalWaveVerdict(output)

    // then
    expect(verdict).toBe("approve")
  })
})

describe("stripVerdictContext", () => {
  test("removes fenced blocks and blockquote lines", () => {
    // given
    const output = `keep
\`\`\`ts
VERDICT: APPROVE
\`\`\`
> quoted
also keep`

    // when
    const stripped = stripVerdictContext(output)

    // then
    expect(stripped).toBe("keep\nalso keep")
  })
})

describe("final-wave advisory completion receipts", () => {
  const testDirectories: string[] = []

  afterEach(() => {
    for (const directory of testDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createWorkspace(): { readonly directory: string; readonly planPath: string } {
    const directory = join(tmpdir(), `final-wave-completion-${randomUUID()}`)
    testDirectories.push(directory)
    mkdirSync(join(directory, ".omo"), { recursive: true })
    const written = writeFinalWaveFixturePlan({
      workspaceRoot: directory,
      slug: "wave",
      variant: "marked-correct",
      completedFinalWaveKeys: ["F1", "F2", "F3"],
    })
    return { directory, planPath: written.planPath }
  }

  function pendingTrack(launchId: string): PendingTaskRef {
    return {
      kind: "track",
      task: {
        key: "final-wave:F4",
        label: "F4",
        title: "Scope fidelity check",
        section: "final-wave",
        expectedRole: "scope-auditor",
        expectedSubagent: "momus",
        launchId,
      },
    }
  }

  test("#given matching identity and APPROVE #when completion is processed #then a receipt is written", () => {
    // given
    const { directory, planPath } = createWorkspace()
    const launchId = "launch-f4-match"
    recordLaunchExpectation(planPath, {
      fKey: "F4",
      role: "scope-auditor",
      subagent: "momus",
      launchId,
    })
    const completion = createFinalWaveTaskCompletion({
      fKey: "F4",
      variant: "marked-correct",
      childSessionID: "ses_f4_match",
    })

    // when
    const result = processFinalWaveAdvisoryCompletion({
      planPath,
      workspaceRoot: directory,
      toolOutput: completion.toolOutput,
      pendingTaskRef: pendingTrack(launchId),
      childSessionId: completion.childSessionID,
      boulderState: {
        active_plan: planPath,
        started_at: "2026-07-20T00:00:00.000Z",
        session_ids: ["atlas"],
        plan_name: "wave",
      },
      spawnGit: () => ({ exitCode: 0, stdout: "" }),
    })

    // then
    expect(result.receiptWritten).toBe(true)
    expect(result.reason).toBe("written")
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(store.receipts.F4?.actualAgent).toBe("momus")
    expect(store.receipts.F4?.launchId).toBe(launchId)
  })

  test("#given mismatched identity #when completion is processed #then no receipt is written", () => {
    // given
    const { directory, planPath } = createWorkspace()
    const launchId = "launch-f4-mismatch"
    recordLaunchExpectation(planPath, {
      fKey: "F4",
      role: "scope-auditor",
      subagent: "momus",
      launchId,
    })
    const completion = createFinalWaveTaskCompletion({
      fKey: "F4",
      variant: "marked-wrong-agent",
      childSessionID: "ses_f4_mismatch",
    })

    // when
    const result = processFinalWaveAdvisoryCompletion({
      planPath,
      workspaceRoot: directory,
      toolOutput: completion.toolOutput,
      pendingTaskRef: pendingTrack(launchId),
      childSessionId: completion.childSessionID,
      boulderState: {
        active_plan: planPath,
        started_at: "2026-07-20T00:00:00.000Z",
        session_ids: ["atlas"],
        plan_name: "wave",
      },
      spawnGit: () => ({ exitCode: 0, stdout: "" }),
    })

    // then
    expect(result.receiptWritten).toBe(false)
    expect(result.reason).toBe("identity-mismatch")
    expect(result.advisoryText).toContain("identity mismatch")
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(store.receipts.F4).toBeUndefined()
  })

  test("#given no durable binding #when completion is processed #then no receipt is written", () => {
    // given
    const { directory, planPath } = createWorkspace()
    recordLaunchExpectation(planPath, {
      fKey: "F4",
      role: "scope-auditor",
      subagent: "momus",
      launchId: "launch-f4-unbound",
    })
    const completion = createFinalWaveTaskCompletion({
      fKey: "F4",
      variant: "marked-correct",
      childSessionID: "ses_f4_unbound",
    })

    // when
    const result = processFinalWaveAdvisoryCompletion({
      planPath,
      workspaceRoot: directory,
      toolOutput: completion.toolOutput,
      pendingTaskRef: undefined,
      childSessionId: completion.childSessionID,
      boulderState: {
        active_plan: planPath,
        started_at: "2026-07-20T00:00:00.000Z",
        session_ids: ["atlas"],
        plan_name: "wave",
      },
      spawnGit: () => ({ exitCode: 0, stdout: "" }),
    })

    // then
    expect(result.receiptWritten).toBe(false)
    expect(result.reason).toBe("missing-binding")
    expect(result.advisoryText).toContain("without a durable launch binding")
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(store.receipts.F4).toBeUndefined()
  })

  test("#given dirty product tree #when completion is processed #then no receipt is written", () => {
    // given
    const { directory, planPath } = createWorkspace()
    const launchId = "launch-f4-dirty"
    recordLaunchExpectation(planPath, {
      fKey: "F4",
      role: "scope-auditor",
      subagent: "momus",
      launchId,
    })
    const completion = createFinalWaveTaskCompletion({
      fKey: "F4",
      variant: "marked-correct",
      childSessionID: "ses_f4_dirty",
    })
    // Force a git baseline so attestation runs (tmp dirs stamp nogit by default).
    const stamped = readReceiptStore(planPath)
    if ("corrupt" in stamped || stamped.baseline === null) throw new Error("expected stamped baseline")
    writeFinalWaveReceiptStore(planPath, {
      version: 1,
      baseline: { ...stamped.baseline, gitHead: "abc123" },
      expectations: stamped.expectations,
      bindings: stamped.bindings,
      receipts: stamped.receipts,
    })

    // when
    const result = processFinalWaveAdvisoryCompletion({
      planPath,
      workspaceRoot: directory,
      toolOutput: completion.toolOutput,
      pendingTaskRef: pendingTrack(launchId),
      childSessionId: completion.childSessionID,
      boulderState: {
        active_plan: planPath,
        started_at: "2026-07-20T00:00:00.000Z",
        session_ids: ["atlas"],
        plan_name: "wave",
      },
      spawnGit: (args) => {
        if (args[0] === "status") {
          return { exitCode: 0, stdout: " M packages/omo-opencode/src/index.ts\n" }
        }
        return { exitCode: 0, stdout: "" }
      },
    })

    // then
    expect(result.receiptWritten).toBe(false)
    expect(result.reason).toBe("dirty-workspace")
    expect(result.advisoryText).toContain("product-code modifications")
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(store.receipts.F4).toBeUndefined()
  })

  test("#given metadata agent absent #when task_sessions has agent #then identity resolves from boulder", () => {
    // given / when
    const agent = resolveFinalWaveActualAgent({
      metadata: {},
      taskKey: "final-wave:F1",
      taskSessions: {
        "final-wave:F1": {
          task_key: "final-wave:F1",
          task_label: "F1",
          task_title: "Plan compliance audit",
          session_id: "ses_f1",
          agent: "momus",
          updated_at: "2026-07-20T00:00:00.000Z",
        },
      },
    })

    // then
    expect(agent).toBe("momus")
  })
})

describe("Atlas final verification approval gate", () => {
  let testDirectory = ""

  function createMockPluginInput(): AtlasHookContext & { _promptMock: PromptMock } {
    const client = createOpencodeClient({ baseUrl: "http://localhost" })
    const promptMock = mock((input: unknown) => input)

    Reflect.set(client.session, "prompt", async (input: unknown) => {
      promptMock(input)
      return {
        data: { info: {} as AssistantMessage, parts: [] },
        request: new Request("http://localhost/session/prompt"),
        response: new Response(),
      }
    })

    Reflect.set(client.session, "promptAsync", async (input: unknown) => {
      promptMock(input)
      return {
        data: undefined,
        request: new Request("http://localhost/session/prompt_async"),
        response: new Response(),
      }
    })

    Reflect.set(client.session, "get", async ({ path }: { path: { id: string } }) => {
      const parentID = path.id === "ses_final_wave_review"
        ? "atlas-final-wave-session"
        : path.id === "ses_feature_task"
          ? "atlas-non-final-session"
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

    Reflect.set(client.tui, "showToast", async () => ({
      data: undefined,
      request: new Request("http://localhost/tui/show-toast"),
      response: new Response(),
    }))

    return {
      directory: testDirectory,
      project: {} as AtlasHookContext["project"],
      worktree: testDirectory,
      serverUrl: new URL("http://localhost"),
      $: {} as AtlasHookContext["$"],
      experimental_workspace: {} as AtlasHookContext["experimental_workspace"],
      client,
      _promptMock: promptMock,
    }
  }

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-final-wave-test-${randomUUID()}`)
    mkdirSync(join(testDirectory, ".omo"), { recursive: true })
    clearBoulderState(testDirectory)
  })

  afterEach(() => {
    clearBoulderState(testDirectory)
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  test("waits for explicit user approval after the last final-wave approval arrives", async () => {
    // given
    const sessionID = "atlas-final-wave-session"

    const planPath = join(testDirectory, "final-wave-plan.md")
    writeFileSync(
      planPath,
      `# Plan

## TODOs
- [x] 1. Ship the implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [x] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    )

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "final-wave-plan",
      agent: "atlas",
    }
    writeBoulderState(testDirectory, state)

    const mockInput = createMockPluginInput()
    const hook = createAtlasHook(mockInput, { directory: testDirectory, isCallerOrchestrator: async () => true })
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Tasks [4/4 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN]
VERDICT: APPROVE

<task_metadata>
session_id: ses_final_wave_review
</task_metadata>`,
      metadata: {},
    }

    // when
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then
    expect(toolOutput.output).toContain("FINAL WAVE APPROVAL GATE")
    expect(toolOutput.output).toContain("explicit user approval")
    expect(toolOutput.output).not.toContain("STEP 8: PROCEED TO NEXT TASK")
    expect(mockInput._promptMock).not.toHaveBeenCalled()

  })

  test("pauses for escalation when a final-wave reviewer rejects", async () => {
    // given
    const sessionID = "atlas-final-wave-session"

    const planPath = join(testDirectory, "final-wave-reject-plan.md")
    writeFileSync(
      planPath,
      `# Plan

## TODOs
- [x] 1. Ship the implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [x] F1. **Plan Compliance Audit** - \`oracle\`
- [x] F2. **Code Quality Review** - \`unspecified-high\`
- [ ] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    )

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "final-wave-reject-plan",
      agent: "atlas",
    }
    writeBoulderState(testDirectory, state)

    const mockInput = createMockPluginInput()
    const hook = createAtlasHook(mockInput, { directory: testDirectory, isCallerOrchestrator: async () => true })
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Manual QA could not verify the shipped behavior.

Tasks [3/4 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN]
VERDICT: REJECT

<task_metadata>
session_id: ses_final_wave_review
</task_metadata>`,
      metadata: {},
    }

    // when
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then
    expect(toolOutput.output).toContain("FINAL REVIEW REJECTED")
    expect(toolOutput.output).toContain("Boulder paused")
    expect(toolOutput.output).toContain("VERDICT: REJECT")
    expect(toolOutput.output).not.toContain("COMPLETION GATE")
    expect(toolOutput.output).not.toContain("STEP 8")
    expect(mockInput._promptMock).not.toHaveBeenCalled()
  })

  test("keeps normal auto-continue instructions for non-final tasks", async () => {
    // given
    const sessionID = "atlas-non-final-session"

    const planPath = join(testDirectory, "implementation-plan.md")
    writeFileSync(
      planPath,
      `# Plan

## TODOs
- [x] 1. Setup
- [ ] 2. Implement feature

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. **Plan Compliance Audit** - \`oracle\`
- [ ] F2. **Code Quality Review** - \`unspecified-high\`
- [ ] F3. **Real Manual QA** - \`unspecified-high\`
- [ ] F4. **Scope Fidelity Check** - \`deep\`
`,
    )

    const state: BoulderState = {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "implementation-plan",
      agent: "atlas",
    }
    writeBoulderState(testDirectory, state)

    const hook = createAtlasHook(createMockPluginInput(), {
      directory: testDirectory,
      isCallerOrchestrator: async () => true,
    })
    const toolOutput = {
      title: "Sisyphus Task",
      output: `Implementation finished successfully

<task_metadata>
session_id: ses_feature_task
</task_metadata>`,
      metadata: {},
    }

    // when
    await hook["tool.execute.after"]({ tool: "task", sessionID }, toolOutput)

    // then
    expect(toolOutput.output).toContain("COMPLETION GATE")
    expect(toolOutput.output).toContain("STEP 8: PROCEED TO NEXT TASK")
    expect(toolOutput.output).not.toContain("FINAL WAVE APPROVAL GATE")

  })

  test("injects the unverified-wave signal for every legacy final-wave completion", async () => {
    // given
    const sessionID = "atlas-final-wave-session"
    const planPath = join(testDirectory, "legacy-final-wave-plan.md")
    writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Ship the implementation

## Final Verification Wave
- [ ] F1. Legacy final review
`)
    writeBoulderState(testDirectory, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "legacy-final-wave-plan",
      agent: "atlas",
    })
    const hook = createAtlasHook(createMockPluginInput(), {
      directory: testDirectory,
      isCallerOrchestrator: async () => true,
    })
    const firstOutput = {
      title: "Sisyphus Task",
      output: "VERDICT: APPROVE\n\n<task_metadata>\nsession_id: ses_final_wave_review\n</task_metadata>",
      metadata: {},
    }
    const secondOutput = { ...firstOutput }

    // when
    await hook["tool.execute.after"]({ tool: "task", sessionID }, firstOutput)
    await hook["tool.execute.after"]({ tool: "task", sessionID }, secondOutput)

    // then
    expect(firstOutput.output).toContain("<unverified-final-wave>")
    expect(secondOutput.output).toContain("<unverified-final-wave>")
  })
})
