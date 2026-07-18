import { describe, expect, test } from "bun:test"
import { parseTrackedTaskFromPrompt } from "./task-prompt-parser"

describe("parseTrackedTaskFromPrompt", () => {
  test("parses a quoted exact plan checkbox", () => {
    // given
    const prompt = "## 1. TASK\nExact plan checkbox: `- [ ] 2. Add tests`\n\n## 2. CONTEXT\n..."

    // when
    const task = parseTrackedTaskFromPrompt(prompt)

    // then
    expect(task).toEqual({
      key: "todo:2",
      label: "2",
      title: "Add tests",
    })
  })
})
