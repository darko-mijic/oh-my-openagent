import { describe, expect, test } from "bun:test"

import { DEFAULT_CATEGORIES } from "../../tools/delegate-task/constants"
import {
  FINAL_WAVE_TASK_ROW,
  FINAL_WAVE_REVIEWER_ROLES,
  parseFinalWaveRoles,
} from "./final-wave-role-parser"

const MARKED_PLAN = [
  "## TODOs",
  "- [ ] 1. Implement feature",
  "",
  "## Final Verification Wave",
  "- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->",
  "- [ ] F2. Code quality review <!-- role:code-reviewer scope:src/a.ts, packages/b.ts -->",
  "- [ ] F3. Real manual QA <!-- role:qa-executor -->",
  "- [ ] F4. Scope fidelity <!-- role:scope-auditor scope:src/a.ts -->",
].join("\n")

const LEGACY_PLAN = [
  "## Final Verification Wave",
  "- [ ] F1. Plan compliance audit",
  "- [ ] F2. Code quality review",
  "- [ ] F3. Real manual QA",
  "- [ ] F4. Scope fidelity",
].join("\n")

describe("parseFinalWaveRoles", () => {
  test("#given all F rows carry valid role markers #when parsed #then status is marked with four rows", () => {
    // given
    const plan = MARKED_PLAN

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.status).toBe("marked")
    expect(result.rows).toEqual([
      { fKey: "F1", title: "Plan compliance audit", role: "plan-auditor", scope: [] },
      {
        fKey: "F2",
        title: "Code quality review",
        role: "code-reviewer",
        scope: ["src/a.ts", "packages/b.ts"],
      },
      { fKey: "F3", title: "Real manual QA", role: "qa-executor", scope: [] },
      { fKey: "F4", title: "Scope fidelity", role: "scope-auditor", scope: ["src/a.ts"] },
    ])
  })

  test("#given zero markers on any F row #when parsed #then status is legacy-unmarked and rows empty", () => {
    // given
    const plan = LEGACY_PLAN

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.status).toBe("legacy-unmarked")
    expect(result.rows).toEqual([])
  })

  test("#given mixed marked and unmarked F rows #when parsed #then status is invalid for mixed marking", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->",
      "- [ ] F2. Code quality review",
      "- [ ] F3. Real manual QA <!-- role:qa-executor -->",
      "- [ ] F4. Scope fidelity",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.rows).toEqual([])
    expect(result.status).not.toBe("marked")
    expect(result.status).not.toBe("legacy-unmarked")
    if (typeof result.status === "string") {
      throw new Error("expected invalid status object")
    }
    expect(result.status.invalid.some((reason) => /mixed/i.test(reason))).toBe(true)
  })

  test("#given role is a DEFAULT_CATEGORIES key #when parsed #then invalid with DC-1 reason", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->",
      "- [ ] F2. Code quality review <!-- role:unspecified-high -->",
      "- [ ] F3. Real manual QA <!-- role:qa-executor -->",
      "- [ ] F4. Scope fidelity <!-- role:scope-auditor -->",
    ].join("\n")
    expect(Object.hasOwn(DEFAULT_CATEGORIES, "unspecified-high")).toBe(true)

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.rows).toEqual([])
    if (typeof result.status === "string") {
      throw new Error("expected invalid status object")
    }
    expect(result.status.invalid.some((reason) => /DC-1/i.test(reason))).toBe(true)
    expect(result.status.invalid.some((reason) => /unspecified-high/.test(reason))).toBe(true)
  })

  test("#given role is deep category name #when parsed #then invalid with DC-1 reason", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Audit <!-- role:deep -->",
    ].join("\n")
    expect(Object.hasOwn(DEFAULT_CATEGORIES, "deep")).toBe(true)

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    if (typeof result.status === "string") {
      throw new Error("expected invalid status object")
    }
    expect(result.status.invalid.some((reason) => /DC-1/i.test(reason))).toBe(true)
    expect(result.status.invalid.some((reason) => /\bdeep\b/.test(reason))).toBe(true)
  })

  test("#given unknown role value #when parsed #then invalid", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Audit <!-- role:security-hunter -->",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    if (typeof result.status === "string") {
      throw new Error("expected invalid status object")
    }
    expect(result.status.invalid.some((reason) => /unknown role/i.test(reason))).toBe(true)
    expect(result.status.invalid.some((reason) => /security-hunter/.test(reason))).toBe(true)
  })

  test("#given duplicate role attributes on one row #when parsed #then invalid", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Audit <!-- role:plan-auditor role:code-reviewer -->",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    if (typeof result.status === "string") {
      throw new Error("expected invalid status object")
    }
    expect(result.status.invalid.some((reason) => /duplicate role/i.test(reason))).toBe(true)
  })

  test("#given malformed marker missing role key #when parsed #then invalid", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Audit <!-- scope:src/a.ts -->",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    if (typeof result.status === "string") {
      throw new Error("expected invalid status object")
    }
    expect(result.status.invalid.some((reason) => /malformed/i.test(reason))).toBe(true)
  })

  test("#given empty role value #when parsed #then invalid malformed", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Audit <!-- role: -->",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    if (typeof result.status === "string") {
      throw new Error("expected invalid status object")
    }
    expect(result.status.invalid.some((reason) => /malformed/i.test(reason))).toBe(true)
  })

  test("#given unclosed HTML comment on F row #when parsed #then invalid malformed", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Audit <!-- role:plan-auditor",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    if (typeof result.status === "string") {
      throw new Error("expected invalid status object")
    }
    expect(result.status.invalid.some((reason) => /malformed/i.test(reason))).toBe(true)
  })

  test("#given scope attribute with commas and whitespace #when parsed #then scope is trimmed path list", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Audit <!-- role:plan-auditor scope: src/a.ts , packages/b.ts ,  docs/c.md  -->",
      "- [ ] F2. Review <!-- role:code-reviewer -->",
      "- [ ] F3. QA <!-- role:qa-executor -->",
      "- [ ] F4. Scope <!-- role:scope-auditor -->",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.status).toBe("marked")
    expect(result.rows[0]?.scope).toEqual(["src/a.ts", "packages/b.ts", "docs/c.md"])
  })

  test("#given role marker only inside fenced code block #when parsed #then fence content ignored as legacy-unmarked", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Plan compliance audit",
      "- [ ] F2. Code quality review",
      "```md",
      "- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->",
      "- [ ] F2. Code quality review <!-- role:code-reviewer -->",
      "```",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.status).toBe("legacy-unmarked")
    expect(result.rows).toEqual([])
  })

  test("#given marked F rows plus fenced decoy markers #when parsed #then only real section rows count as marked", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->",
      "- [ ] F2. Code quality review <!-- role:code-reviewer -->",
      "- [ ] F3. Real manual QA <!-- role:qa-executor -->",
      "- [ ] F4. Scope fidelity <!-- role:scope-auditor -->",
      "```",
      "- [ ] F9. Decoy <!-- role:unspecified-high -->",
      "```",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.status).toBe("marked")
    expect(result.rows).toHaveLength(4)
  })

  test("#given F row with trailing role marker #when matched against FINAL_WAVE_TASK_ROW #then regex still matches", () => {
    // given
    const line = "- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->"

    // when
    const matches = FINAL_WAVE_TASK_ROW.test(line)

    // then
    expect(matches).toBe(true)
    // Same shape as plan-format-validator FINAL_WAVE_TASK
    expect(/^- \[[ xX]\] F[1-9]\d*\. .+$/i.test(line)).toBe(true)
  })

  test("#given no Final Verification Wave section #when parsed #then legacy-unmarked", () => {
    // given
    const plan = ["## TODOs", "- [ ] 1. Do work", "- [ ] F1. Not in final wave <!-- role:plan-auditor -->"].join(
      "\n",
    )

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.status).toBe("legacy-unmarked")
    expect(result.rows).toEqual([])
  })

  test("#given checked F rows with valid markers #when parsed #then still marked", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [x] F1. Plan compliance audit <!-- role:plan-auditor -->",
      "- [X] F2. Code quality review <!-- role:code-reviewer -->",
      "- [ ] F3. Real manual QA <!-- role:qa-executor -->",
      "- [ ] F4. Scope fidelity <!-- role:scope-auditor -->",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.status).toBe("marked")
    expect(result.rows.map((row) => row.fKey)).toEqual(["F1", "F2", "F3", "F4"])
  })

  test("#given lowercase and blocked F-row states #when parsed #then keys are canonical uppercase", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [~] f1. Plan compliance audit <!-- role:plan-auditor -->",
      "- [x] f2. Code quality review <!-- role:code-reviewer -->",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    expect(result.status).toBe("marked")
    expect(result.rows.map((row) => row.fKey)).toEqual(["F1", "F2"])
  })

  test("#given reviewer role vocabulary #when inspected #then matches the four locked roles", () => {
    // given / when / then
    expect([...FINAL_WAVE_REVIEWER_ROLES]).toEqual([
      "plan-auditor",
      "code-reviewer",
      "qa-executor",
      "scope-auditor",
    ])
  })

  test("#given quick category used as role #when parsed #then invalid with DC-1", () => {
    // given
    const plan = [
      "## Final Verification Wave",
      "- [ ] F1. Audit <!-- role:quick -->",
    ].join("\n")

    // when
    const result = parseFinalWaveRoles(plan)

    // then
    if (typeof result.status === "string") {
      throw new Error("expected invalid status object")
    }
    expect(result.status.invalid.some((reason) => /DC-1/i.test(reason))).toBe(true)
    expect(result.status.invalid.some((reason) => /\bquick\b/.test(reason))).toBe(true)
  })
})
