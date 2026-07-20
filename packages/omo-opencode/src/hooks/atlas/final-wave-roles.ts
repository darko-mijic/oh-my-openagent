import type { FinalWaveRole } from "./final-wave-role-parser"

export const FINAL_WAVE_ROLE_SUBAGENT_BINDINGS = {
  "plan-auditor": "momus",
  "code-reviewer": "oracle",
  "qa-executor": "qa-executor",
  "scope-auditor": "momus",
} as const satisfies Record<FinalWaveRole, string>

export type FinalWaveBoundSubagent =
  (typeof FINAL_WAVE_ROLE_SUBAGENT_BINDINGS)[FinalWaveRole]

export function resolveFinalWaveBoundSubagent(role: FinalWaveRole): FinalWaveBoundSubagent {
  return FINAL_WAVE_ROLE_SUBAGENT_BINDINGS[role]
}
