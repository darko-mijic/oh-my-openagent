import { afterEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import {
  clearBoulderState,
  writeBoulderState,
  type BoulderState,
} from "../../features/boulder-state"
import { createAtlasEventHandler } from "./event-handler"
import { shouldPauseForFinalWaveApproval } from "./final-wave-approval-gate"
import {
  processFinalWaveAdvisoryCompletion,
  resolveFinalWaveBindingTarget,
} from "./final-wave-completion-verification"
import {
  hasAllFinalWaveReceipts,
  hasFinalWaveReceiptForRow,
  reconstructFinalWavePauseState,
  resolveFinalWaveEnforcement,
} from "./final-wave-enforcement"
import {
  FINAL_WAVE_FIXTURE_KEYS,
  FINAL_WAVE_FIXTURE_ROWS,
  writeFinalWaveFixturePlan,
} from "./final-wave-fixtures"
import { createFinalWaveTaskCompletion } from "./final-wave-mock-completion"
import {
  readReceiptStore,
  recordBinding,
  recordLaunchExpectation,
  stampBaseline,
  writeReceipt,
} from "./final-wave-receipts"
import { createAtlasHook } from "./index"
import { buildSubagentCompletionReminder } from "./subagent-completion-reminder"
import type { PendingTaskRef, SessionState } from "./types"

const testDirectories: string[] = []

type AtlasHookContext = Parameters<typeof createAtlasHook>[0]

function createWorkspace(initGit = true): string {
  const directory = join(tmpdir(), `final-wave-bypass-${randomUUID()}`)
  testDirectories.push(directory)
  mkdirSync(join(directory, ".omo", "plans"), { recursive: true })
  if (initGit) {
    runGit(directory, ["init"])
    runGit(directory, ["config", "user.email", "test@example.com"])
    runGit(directory, ["config", "user.name", "Test"])
    writeFileSync(join(directory, "README.md"), "fixture\n")
    runGit(directory, ["add", "README.md"])
    runGit(directory, ["commit", "-m", "init"])
  }
  return directory
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  }
}

function writeMarkedPlan(directory: string): string {
  return writeFinalWaveFixturePlan({
    workspaceRoot: directory,
    slug: "bypass-wave",
    variant: "marked-correct",
  }).planPath
}

function emptySessionState(): SessionState {
  return { promptFailureCount: 0 }
}

function establishReceipt(planPath: string, fKey: keyof typeof FINAL_WAVE_FIXTURE_ROWS): void {
  const row = FINAL_WAVE_FIXTURE_ROWS[fKey]
  const launchId = `launch-${fKey}`
  recordLaunchExpectation(planPath, {
    fKey,
    role: row.role,
    subagent: row.subagent,
    launchId,
  })
  recordBinding(planPath, {
    launchId,
    fKey,
    childSessionId: `ses_${fKey}`,
  })
  writeReceipt(planPath, {
    fKey,
    launchId,
    childSessionId: `ses_${fKey}`,
    actualAgent: row.subagent,
    fingerprint: { gitHead: "nogit", scopePaths: [], scopeHash: "hash" },
  })
}

function establishAllReceipts(planPath: string): void {
  for (const fKey of FINAL_WAVE_FIXTURE_KEYS) {
    establishReceipt(planPath, fKey)
  }
}

function createMockPluginInput(directory: string): AtlasHookContext & {
  _promptMock: ReturnType<typeof mock>
} {
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
  Reflect.set(client.session, "get", async ({ path }: { path: { id: string } }) => ({
    data: {
      id: path.id,
      parentID: path.id.startsWith("ses_") ? "atlas-bypass-session" : "main-session",
    } as Session,
    request: new Request(`http://localhost/session/${path.id}`),
    response: new Response(),
  }))
  Reflect.set(client.tui, "showToast", async () => ({
    data: undefined,
    request: new Request("http://localhost/tui/show-toast"),
    response: new Response(),
  }))

  return {
    directory,
    project: {} as AtlasHookContext["project"],
    worktree: directory,
    serverUrl: new URL("http://localhost"),
    $: {} as AtlasHookContext["$"],
    experimental_workspace: {} as AtlasHookContext["experimental_workspace"],
    client,
    _promptMock: promptMock,
  }
}

function writeBoulder(directory: string, planPath: string, sessionID: string): void {
  const state: BoulderState = {
    active_plan: planPath,
    started_at: "2026-07-20T00:00:00.000Z",
    session_ids: [sessionID],
    plan_name: "bypass-wave",
    agent: "atlas",
  }
  writeBoulderState(directory, state)
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    clearBoulderState(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("final-wave bypass hardening — advance path", () => {
  test("#given enforced F-row without receipt #when reminder builds #then advance directive is unreachable", async () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    stampBaseline(planPath)
    const sessionState = emptySessionState()
    const ctx = createMockPluginInput(directory)

    // when — checkbox-style "already verified" without a durable receipt
    const decision = await buildSubagentCompletionReminder({
      ctx,
      planPath,
      planName: "bypass-wave",
      progress: { total: 5, completed: 2 },
      preferredSessionId: "ses_f1",
      originalResponse: "VERDICT: APPROVE",
      currentTask: {
        key: "final-wave:F1",
        label: "F1",
        section: "final-wave",
      },
      sessionState,
      isAlreadyVerified: true,
      autoCommit: false,
    })

    // then
    expect(hasFinalWaveReceiptForRow(planPath, "F1")).toBe(false)
    expect(decision.leadReminder).not.toContain("TASK ALREADY COMPLETE")
    expect(decision.leadReminder).not.toContain("ADVANCE TO NEXT")
    expect(decision.shouldPauseForApproval).toBe(false)
  })

  test("#given enforced F-row with receipt and more rows remaining #when reminder builds #then advance is allowed", async () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    establishReceipt(planPath, "F1")
    const sessionState = emptySessionState()
    const ctx = createMockPluginInput(directory)

    // when
    const decision = await buildSubagentCompletionReminder({
      ctx,
      planPath,
      planName: "bypass-wave",
      progress: { total: 5, completed: 2 },
      preferredSessionId: "ses_f1",
      originalResponse: "VERDICT: APPROVE",
      currentTask: {
        key: "final-wave:F1",
        label: "F1",
        section: "final-wave",
      },
      sessionState,
      isAlreadyVerified: true,
      autoCommit: false,
    })

    // then
    expect(decision.leadReminder).toContain("TASK ALREADY COMPLETE")
    expect(decision.leadReminder).toContain("ADVANCE TO NEXT")
    expect(decision.shouldPauseForApproval).toBe(false)
  })
})

describe("final-wave bypass hardening — positive fixture end-to-end", () => {
  test("#given correctly-routed F1-F4 APPROVE completions #when all receipts land #then gate pauses once and user approval clears", async () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    const sessionID = "atlas-bypass-session"
    writeBoulder(directory, planPath, sessionID)
    const sessionState = emptySessionState()
    const ctx = createMockPluginInput(directory)
    let pauseCount = 0

    // when — correctly-routed F1 momus / F2 oracle / F3 qa-executor / F4 momus
    for (const fKey of FINAL_WAVE_FIXTURE_KEYS) {
      const row = FINAL_WAVE_FIXTURE_ROWS[fKey]
      const launchId = `launch-positive-${fKey}`
      recordLaunchExpectation(planPath, {
        fKey,
        role: row.role,
        subagent: row.subagent,
        launchId,
      })
      const completion = createFinalWaveTaskCompletion({
        fKey,
        variant: "marked-correct",
        childSessionID: `ses_positive_${fKey}`,
      })
      const pendingTaskRef: PendingTaskRef = {
        kind: "track",
        task: {
          key: `final-wave:${fKey}`,
          label: fKey,
          title: row.title,
          section: "final-wave",
          expectedRole: row.role,
          expectedSubagent: row.subagent,
          launchId,
        },
      }

      const result = processFinalWaveAdvisoryCompletion({
        planPath,
        workspaceRoot: directory,
        toolOutput: completion.toolOutput,
        pendingTaskRef,
        childSessionId: completion.childSessionID,
        boulderState: {
          active_plan: planPath,
          started_at: "2026-07-20T00:00:00.000Z",
          session_ids: [sessionID],
          plan_name: "bypass-wave",
        },
        spawnGit: () => ({ exitCode: 0, stdout: "" }),
      })
      expect(result.receiptWritten).toBe(true)

      const decision = await buildSubagentCompletionReminder({
        ctx,
        planPath,
        planName: "bypass-wave",
        progress: { total: 5, completed: 1 + FINAL_WAVE_FIXTURE_KEYS.indexOf(fKey) },
        preferredSessionId: completion.childSessionID,
        originalResponse: completion.toolOutput.output,
        currentTask: {
          key: `final-wave:${fKey}`,
          label: fKey,
          section: "final-wave",
        },
        sessionState,
        isAlreadyVerified: true,
        autoCommit: false,
      })

      if (decision.shouldPauseForApproval) {
        pauseCount += 1
        expect(decision.leadReminder).toContain("FINAL WAVE APPROVAL GATE")
      }
    }

    // then — 4 receipts, single pause
    const store = readReceiptStore(planPath)
    if ("corrupt" in store) throw new Error("expected valid store")
    expect(Object.keys(store.receipts).sort()).toEqual(["F1", "F2", "F3", "F4"])
    expect(pauseCount).toBe(1)
    expect(sessionState.waitingForFinalWaveApproval).toBe(true)
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(true)

    // when — simulated explicit user approval after all receipts
    const sessions = new Map<string, SessionState>([[sessionID, sessionState]])
    const handler = createAtlasEventHandler({
      ctx,
      sessions,
      getState: (id) => {
        let state = sessions.get(id)
        if (!state) {
          state = emptySessionState()
          sessions.set(id, state)
        }
        return state
      },
    })
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: { role: "user", sessionID },
          sessionID,
        },
      },
    })

    // then — pause clears only after all receipts exist
    expect(sessionState.waitingForFinalWaveApproval).toBe(false)
  })
})

describe("final-wave bypass hardening — user message", () => {
  test("#given enforced plan with partial receipts #when user message arrives #then pause flag is not cleared", async () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    establishReceipt(planPath, "F1")
    establishReceipt(planPath, "F2")
    const sessionID = "atlas-bypass-session"
    writeBoulder(directory, planPath, sessionID)
    const sessionState = emptySessionState()
    sessionState.waitingForFinalWaveApproval = true
    const sessions = new Map<string, SessionState>([[sessionID, sessionState]])
    const handler = createAtlasEventHandler({
      ctx: createMockPluginInput(directory),
      sessions,
      getState: (id) => sessions.get(id) ?? emptySessionState(),
    })

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: { role: "user", sessionID },
          sessionID,
        },
      },
    })

    // then
    expect(hasAllFinalWaveReceipts(planPath, directory)).toBe(false)
    expect(sessionState.waitingForFinalWaveApproval).toBe(true)
  })

  test("#given blocked marked plan #when user message arrives #then pause flag is never cleared", async () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    stampBaseline(planPath)
    writeFileSync(
      planPath,
      // delete F4 to violate frozen contract
      readFileSync(planPath, "utf-8").replace(/^.*F4.*\n/m, ""),
    )
    expect(resolveFinalWaveEnforcement(planPath, directory).mode).toBe("blocked")
    const sessionID = "atlas-bypass-session"
    writeBoulder(directory, planPath, sessionID)
    const sessionState = emptySessionState()
    sessionState.waitingForFinalWaveApproval = true
    const sessions = new Map<string, SessionState>([[sessionID, sessionState]])
    const handler = createAtlasEventHandler({
      ctx: createMockPluginInput(directory),
      sessions,
      getState: (id) => sessions.get(id) ?? emptySessionState(),
    })

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: { role: "user", sessionID },
          sessionID,
        },
      },
    })

    // then
    expect(sessionState.waitingForFinalWaveApproval).toBe(true)
  })

  test("#given advisory legacy plan #when user message arrives #then pause flag still clears", async () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeFinalWaveFixturePlan({
      workspaceRoot: directory,
      slug: "legacy-bypass",
      variant: "legacy-unmarked",
    }).planPath
    const sessionID = "atlas-bypass-session"
    writeBoulder(directory, planPath, sessionID)
    const sessionState = emptySessionState()
    sessionState.waitingForFinalWaveApproval = true
    const sessions = new Map<string, SessionState>([[sessionID, sessionState]])
    const handler = createAtlasEventHandler({
      ctx: createMockPluginInput(directory),
      sessions,
      getState: (id) => sessions.get(id) ?? emptySessionState(),
    })

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: { role: "user", sessionID },
          sessionID,
        },
      },
    })

    // then
    expect(sessionState.waitingForFinalWaveApproval).toBe(false)
  })
})

describe("final-wave bypass hardening — compaction/restart reconstruction", () => {
  test("#given two receipts then dropped in-memory state #when reconstructed #then counters restore and remaining receipts stay required", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    establishReceipt(planPath, "F1")
    establishReceipt(planPath, "F2")
    // simulate compaction: fresh session state
    const sessionState = emptySessionState()

    // when
    const reconstructed = reconstructFinalWavePauseState(sessionState, planPath, directory)

    // then — mid-wave does not pause; remaining 2 receipts still required
    expect(reconstructed.approvedCount).toBe(2)
    expect(reconstructed.requiredCount).toBe(4)
    expect(reconstructed.waitingForApproval).toBe(false)
    expect(sessionState.waitingForFinalWaveApproval).toBeUndefined()
    expect(sessionState.approvedFinalWaveTaskCount).toBe(2)
    expect(sessionState.pendingFinalWaveTaskCount).toBe(4)
    expect(hasFinalWaveReceiptForRow(planPath, "F3")).toBe(false)
    expect(hasFinalWaveReceiptForRow(planPath, "F4")).toBe(false)
    expect(shouldPauseForFinalWaveApproval({
      planPath,
      taskOutput: "VERDICT: APPROVE",
      sessionState,
      workspaceRoot: directory,
    })).toBe(false)
  })

  test("#given all receipts then dropped in-memory state #when reconstructed #then pause flag is restored from sidecar", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    establishAllReceipts(planPath)
    const sessionState = emptySessionState()

    // when
    const reconstructed = reconstructFinalWavePauseState(sessionState, planPath, directory)

    // then
    expect(reconstructed.approvedCount).toBe(4)
    expect(reconstructed.requiredCount).toBe(4)
    expect(reconstructed.waitingForApproval).toBe(true)
    expect(sessionState.waitingForFinalWaveApproval).toBe(true)
  })

  test("#given session.compacted then idle after full receipts #when handled #then idle does not auto-continue", async () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    establishAllReceipts(planPath)
    const sessionID = "atlas-bypass-session"
    writeBoulder(directory, planPath, sessionID)
    const mockInput = createMockPluginInput(directory)
    const hook = createAtlasHook(mockInput, {
      directory,
      idleSettleMs: 0,
      isCallerOrchestrator: async () => true,
    })

    // seed then compact (drops in-memory state)
    await hook.handler({
      event: {
        type: "message.updated",
        properties: {
          info: { role: "assistant", sessionID },
          sessionID,
        },
      },
    })
    await hook.handler({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    // when — idle after restart/compaction must rebuild pause from sidecar
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // then
    expect(mockInput._promptMock).not.toHaveBeenCalled()
  })

  test("#given completion after restart with durable binding #when processed #then receipt is written from sidecar binding", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    const launchId = "launch-restart-f3"
    const childSessionId = "ses_restart_f3"
    recordLaunchExpectation(planPath, {
      fKey: "F3",
      role: "qa-executor",
      subagent: "qa-executor",
      launchId,
    })
    recordBinding(planPath, {
      launchId,
      fKey: "F3",
      childSessionId,
    })
    // no pending ref — restart lost in-memory pendingTaskRefs
    const completion = createFinalWaveTaskCompletion({
      fKey: "F3",
      variant: "marked-correct",
      childSessionID: childSessionId,
    })

    // when
    const binding = resolveFinalWaveBindingTarget({
      planPath,
      pendingTaskRef: undefined,
      childSessionId,
    })
    const result = processFinalWaveAdvisoryCompletion({
      planPath,
      workspaceRoot: directory,
      toolOutput: completion.toolOutput,
      pendingTaskRef: undefined,
      childSessionId,
      boulderState: {
        active_plan: planPath,
        started_at: "2026-07-20T00:00:00.000Z",
        session_ids: ["atlas"],
        plan_name: "bypass-wave",
      },
      spawnGit: () => ({ exitCode: 0, stdout: "" }),
    })

    // then
    expect(binding).toEqual({
      launchId,
      fKey: "F3",
      childSessionId,
    })
    expect(result.receiptWritten).toBe(true)
    expect(hasFinalWaveReceiptForRow(planPath, "F3")).toBe(true)
  })

  test("#given completion after restart with no binding #when processed #then no receipt and no top-level-task fallback", () => {
    // given
    const directory = createWorkspace(true)
    const planPath = writeMarkedPlan(directory)
    stampBaseline(planPath)
    recordLaunchExpectation(planPath, {
      fKey: "F2",
      role: "code-reviewer",
      subagent: "oracle",
      launchId: "launch-unbound-f2",
    })
    const completion = createFinalWaveTaskCompletion({
      fKey: "F2",
      variant: "marked-correct",
      childSessionID: "ses_unbound_after_restart",
    })

    // when
    const binding = resolveFinalWaveBindingTarget({
      planPath,
      pendingTaskRef: undefined,
      childSessionId: completion.childSessionID,
    })
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
        plan_name: "bypass-wave",
      },
      spawnGit: () => ({ exitCode: 0, stdout: "" }),
    })

    // then — mismatched/missing binding never falls back to readCurrentTopLevelTask
    expect(binding).toBeNull()
    expect(result.receiptWritten).toBe(false)
    expect(result.reason).toBe("missing-binding")
    expect(hasFinalWaveReceiptForRow(planPath, "F2")).toBe(false)
  })
})
