import { describe, expect, test } from "bun:test"
import { FINAL_WAVE_REVIEWER_ROLES } from "./final-wave-role-parser"
import {
  FINAL_WAVE_ROLE_SUBAGENT_BINDINGS,
  resolveFinalWaveBoundSubagent,
} from "./final-wave-roles"

describe("FINAL_WAVE_ROLE_SUBAGENT_BINDINGS", () => {
  test("#given the locked reviewer mapping #when resolved #then every role binds to its named subagent", () => {
    // given / when / then
    expect(FINAL_WAVE_ROLE_SUBAGENT_BINDINGS).toEqual({
      "plan-auditor": "momus",
      "code-reviewer": "oracle",
      "qa-executor": "qa-executor",
      "scope-auditor": "momus",
    })
    for (const role of FINAL_WAVE_REVIEWER_ROLES) {
      expect(resolveFinalWaveBoundSubagent(role)).toBe(FINAL_WAVE_ROLE_SUBAGENT_BINDINGS[role])
    }
  })
})
