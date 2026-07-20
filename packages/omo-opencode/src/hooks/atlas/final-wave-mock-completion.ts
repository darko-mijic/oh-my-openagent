import {
  FINAL_WAVE_FIXTURE_ROWS,
  type FinalWaveFixtureKey,
  type FinalWaveFixtureVariant,
} from "./final-wave-fixtures"

export type FinalWaveCompletionVerdict = "approve" | "reject"

export type FinalWaveTaskCompletionInput = {
  readonly fKey: FinalWaveFixtureKey
  readonly variant: FinalWaveFixtureVariant
  readonly verdict?: FinalWaveCompletionVerdict
  readonly childSessionID?: string
}

export type FinalWaveTaskCompletion = {
  readonly fKey: FinalWaveFixtureKey
  readonly childSessionID: string
  readonly toolOutput: {
    readonly title: string
    readonly output: string
    readonly metadata: { readonly agent: "momus" | "oracle" | "qa-executor" | "sisyphus-junior" }
  }
}

export function createFinalWaveTaskCompletion(input: FinalWaveTaskCompletionInput): FinalWaveTaskCompletion {
  const row = FINAL_WAVE_FIXTURE_ROWS[input.fKey]
  const childSessionID = input.childSessionID ?? `ses_final_wave_${input.fKey.toLowerCase()}`
  const verdict = input.verdict ?? "approve"
  const agent = completionAgentFor(input.variant, row.subagent)

  return {
    fKey: input.fKey,
    childSessionID,
    toolOutput: {
      title: `${input.fKey} final review`,
      output: `${row.title}\nVERDICT: ${verdict.toUpperCase()}\n\n<task_metadata>\nsession_id: ${childSessionID}\n</task_metadata>`,
      metadata: { agent },
    },
  }
}

function completionAgentFor(
  variant: FinalWaveFixtureVariant,
  expectedAgent: "momus" | "oracle" | "qa-executor",
): "momus" | "oracle" | "qa-executor" | "sisyphus-junior" {
  switch (variant) {
    case "legacy-unmarked":
    case "marked-correct":
    case "marked-wrong-category":
    case "corrupt-sidecar":
      return expectedAgent
    case "marked-wrong-agent":
      return "sisyphus-junior"
    default:
      return assertNever(variant)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected final-wave fixture variant: ${String(value)}`)
}
