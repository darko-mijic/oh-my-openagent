import { AGENT_MODEL_REQUIREMENTS } from "../../../packages/model-core/src/agent-model-requirements.ts"
import { buildRetryModelPayload } from "../../../packages/omo-opencode/src/hooks/runtime-fallback/retry-model-payload.ts"
import { applyFallbackToChatMessage } from "../../../packages/omo-opencode/src/hooks/model-fallback/chat-message-fallback-handler.ts"
import {
  clearAllSessionPromptParams,
  getSessionPromptParams,
} from "../../../packages/omo-opencode/src/shared/session-prompt-params-state.ts"
import type { ChatMessageHandlerOutput, ChatMessageInput } from "../../../packages/omo-opencode/src/plugin/chat-message.ts"

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

const grok = AGENT_MODEL_REQUIREMENTS.prometheus.fallbackChain.find((e) => e.model === "grok-4.5")
assert(grok?.reasoningEffort === "high", `prometheus grok entry missing reasoningEffort high: ${JSON.stringify(grok)}`)
assert(grok?.variant === "high", `prometheus grok entry missing variant high`)

const retry = buildRetryModelPayload("xai/grok-4.5", {})
assert(retry?.reasoningEffort === "high", `retry payload missing high effort: ${JSON.stringify(retry)}`)
assert(retry?.model.providerID === "xai" && retry.model.modelID === "grok-4.5", "retry model parse failed")

clearAllSessionPromptParams()
const sessionID = "ses_qa_prometheus_grok_effort"
const input = { sessionID } as ChatMessageInput
const output = {
  message: { model: { providerID: "anthropic", modelID: "claude-opus-4-7" } },
  parts: [],
} as ChatMessageHandlerOutput
await applyFallbackToChatMessage({
  input,
  output,
  fallback: {
    providerID: "xai",
    modelID: "grok-4.5",
    variant: "high",
    reasoningEffort: "high",
  },
  lastToastKey: new Map(),
})
assert(
  getSessionPromptParams(sessionID)?.options?.reasoningEffort === "high",
  `session params missing high effort: ${JSON.stringify(getSessionPromptParams(sessionID))}`,
)
assert(
  JSON.stringify(output.message.model) === JSON.stringify({ providerID: "xai", modelID: "grok-4.5" }),
  "model override missing",
)

await applyFallbackToChatMessage({
  input,
  output,
  fallback: { providerID: "openai", modelID: "gpt-5.5", variant: "high" },
  lastToastKey: new Map(),
})
assert(getSessionPromptParams(sessionID) === undefined, "expected session params cleared")

clearAllSessionPromptParams()
console.log(JSON.stringify({
  ok: true,
  prometheusGrok: grok,
  retryPayload: retry,
  clearedAfterNoEffortFallback: true,
}, null, 2))
