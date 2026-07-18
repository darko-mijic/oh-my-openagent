/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getBoulderWorks, readBoulderState } from "../../features/boulder-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createStartWorkHook } from "./index"
import { createNewWorkOrInitialize } from "./work-initializer"

describe("start-work idempotency", () => {
  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `start-work-idempotency-${crypto.randomUUID()}`)
    mkdirSync(join(testDirectory, ".omo", "plans"), { recursive: true })
  })

  afterEach(() => {
    rmSync(testDirectory, { recursive: true, force: true })
  })

  test("keeps one work when the same plan is initialized twice", () => {
    // given
    const planPath = join(testDirectory, ".omo", "plans", "idempotent-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1")
    const params = {
      directory: testDirectory,
      planPath,
      sessionId: "session-idempotent",
      activeAgent: "atlas",
      worktreePath: undefined,
    }

    // when
    createNewWorkOrInitialize(params)
    createNewWorkOrInitialize(params)

    // then
    const state = readBoulderState(testDirectory)
    expect(state ? getBoulderWorks(state) : []).toHaveLength(1)
  })

  test("resumes one existing work when a plan path is handled twice", async () => {
    // given
    const planPath = join(testDirectory, ".omo", "plans", "path-selected-plan.md")
    writeFileSync(planPath, "# Path Selected Plan\n- [ ] Task 1")
    const hook = createStartWorkHook(unsafeTestValue<Parameters<typeof createStartWorkHook>[0]>({
      directory: testDirectory,
      client: { session: { messages: async () => ({ data: [] }) } },
    }))
    const commandText = `<command-instruction>You are starting an Atlas work session.</command-instruction>
<session-context></session-context>
<user-request>${planPath}</user-request>`
    const firstOutput = { parts: [{ type: "text", text: commandText }] }
    const secondOutput = { parts: [{ type: "text", text: commandText }] }

    // when
    await hook["chat.message"]({ sessionID: "session-path-plan" }, firstOutput)
    await hook["chat.message"]({ sessionID: "session-path-plan" }, secondOutput)

    // then
    const state = readBoulderState(testDirectory)
    expect(state ? getBoulderWorks(state) : []).toHaveLength(1)
    expect(secondOutput.parts[0].text).toContain("RESUMING")
  })
})
