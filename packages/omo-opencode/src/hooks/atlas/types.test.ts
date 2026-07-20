import { describe, expect, test } from "bun:test"

import { normalizeTrackedTopLevelTaskRef } from "./types"
import type { PendingTaskRef } from "./types"

describe("PendingTaskRef", () => {
  test("#given a final-wave ref with reviewer expectations #when normalized and stored #then optional fields round-trip", () => {
    // given
    const pendingTaskRef: PendingTaskRef = {
      kind: "track",
      task: normalizeTrackedTopLevelTaskRef({
        key: "final-wave:f2",
        label: "F2",
        title: "Code quality review",
        expectedRole: "code-reviewer",
        expectedSubagent: "oracle",
        launchId: "launch-f2-test",
      }),
    }

    // when
    const task = pendingTaskRef.kind === "track" ? pendingTaskRef.task : null

    // then
    expect(task).toEqual({
      key: "final-wave:f2",
      section: "final-wave",
      label: "F2",
      title: "Code quality review",
      expectedRole: "code-reviewer",
      expectedSubagent: "oracle",
      launchId: "launch-f2-test",
    })
  })
})
