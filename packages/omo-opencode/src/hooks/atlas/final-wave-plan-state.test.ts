import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readFinalWavePlanState } from "./final-wave-plan-state"

const temporaryDirectories: string[] = []

function writePlan(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "final-wave-plan-state-"))
  temporaryDirectories.push(directory)
  const planPath = join(directory, "plan.md")
  writeFileSync(planPath, content, "utf-8")
  return planPath
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("readFinalWavePlanState", () => {
  test("#given marked final-wave rows #when read #then preserves checkbox counts and exposes parsed roles", () => {
    // given
    const planPath = writePlan(`## TODOs
- [ ] 1. Implement

## Final Verification Wave
- [ ] F1. Plan audit <!-- role:plan-auditor -->
- [x] F2. Code review <!-- role:code-reviewer -->
`)

    // when
    const state = readFinalWavePlanState(planPath)

    // then
    expect(state).toEqual({
      hasFinalVerificationWave: true,
      pendingImplementationTaskCount: 1,
      pendingFinalWaveTaskCount: 1,
      finalWaveRoles: {
        status: "marked",
        rows: [
          { fKey: "F1", title: "Plan audit", role: "plan-auditor", scope: [] },
          { fKey: "F2", title: "Code review", role: "code-reviewer", scope: [] },
        ],
      },
    })
  })

  test("#given an F row inside a fenced block #when read #then it does not increase the pending final-wave count", () => {
    // given
    const planPath = writePlan(`## Final Verification Wave
- [ ] F1. Launchable review <!-- role:plan-auditor -->

\`\`\`md
- [ ] F2. Fenced decoy
\`\`\`
`)

    // when
    const state = readFinalWavePlanState(planPath)

    // then
    expect(state?.pendingFinalWaveTaskCount).toBe(1)
    expect(state?.finalWaveRoles.status).toBe("marked")
  })

  test("#given a legacy F-wave with a noncanonical unchecked row #when read #then preserves existing counter semantics", () => {
    // given
    const planPath = writePlan(`## Final Verification Wave
* [ ] F0. Legacy progress row
`)

    // when
    const state = readFinalWavePlanState(planPath)

    // then
    expect(state?.pendingFinalWaveTaskCount).toBe(1)
    expect(state?.finalWaveRoles.status).toBe("legacy-unmarked")
  })
})
