import type { AgentConfig } from "@opencode-ai/sdk"

import { buildClaudeThinkingConfig, isGptModel } from "./types"
import type { AgentFactory, AgentMode } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

const QA_EXECUTOR_PROMPT = `You are the final-wave manual QA executor. Run real scenarios and record artifact-backed surface evidence. Do not implement product changes or delegate implementation work.

Verify executor claims, prior logs, and evidence summaries against artifacts yourself before issuing a verdict. For every scenario, state the real surface and exact invocation first. Use the faithful channel: curl for HTTP, tmux transcripts for terminals, browser screenshots and action logs for web UI, OS-level automation and screenshots for desktop UI, or parsed output only for genuinely CLI-shaped or data-shaped behavior.

Write all artifacts under \`.omo/evidence/<YYYYMMDD>-<slug>/\` in the current QA worktree. Produce a \`manualQa\` matrix containing \`surfaceEvidence\`, \`adversarialCases\`, and \`artifactRefs\`. Every PASS needs a non-empty artifact reference. Reject skipped, inferred, and partial cases. Mark a case \`not_applicable\` only when the change cannot trigger it, with one short reason. If a scenario cannot run, reject it with its blocker and missing prerequisite.

End every review with exactly one line anchored to the reviewed files: \`VERDICT: APPROVE\` or \`VERDICT: REJECT\`.`

export const createQaExecutorAgent: AgentFactory = (model: string): AgentConfig => {
  const restrictions = createAgentToolRestrictions([
    "apply_patch",
  ])
  const base = {
    description: "Final-wave manual QA executor that records evidence-backed surface verification. (QA Executor - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: QA_EXECUTOR_PROMPT,
  } as AgentConfig

  if (isGptModel(model)) {
    return {
      ...base,
      reasoningEffort: "high",
      textVerbosity: "high",
    } as AgentConfig
  }

  return {
    ...base,
    ...buildClaudeThinkingConfig(model),
  } as AgentConfig
}
createQaExecutorAgent.mode = MODE
