import { afterEach, describe, expect, test } from "bun:test"

import {
  clearAllSessionPromptParams,
  getSessionPromptParams,
} from "../../shared/session-prompt-params-state"
import { applyFallbackToChatMessage } from "./chat-message-fallback-handler"
import type { ChatMessageHandlerOutput, ChatMessageInput } from "../../plugin/chat-message"

describe("applyFallbackToChatMessage", () => {
  afterEach(() => {
    clearAllSessionPromptParams()
  })

  test("stores reasoningEffort high on session prompt params when fallback carries it", async () => {
    // given
    const sessionID = "ses_model_fallback_effort"
    const input = { sessionID } as ChatMessageInput
    const output = {
      message: {
        model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
        variant: "max",
      },
      parts: [],
    } as ChatMessageHandlerOutput
    const lastToastKey = new Map<string, string>()

    // when
    await applyFallbackToChatMessage({
      input,
      output,
      fallback: {
        providerID: "xai",
        modelID: "grok-4.5",
        variant: "high",
        reasoningEffort: "high",
      },
      lastToastKey,
    })

    // then
    expect(output.message["model"]).toEqual({
      providerID: "xai",
      modelID: "grok-4.5",
    })
    expect(output.message["variant"]).toBe("high")
    expect(getSessionPromptParams(sessionID)?.options?.reasoningEffort).toBe("high")
  })

  test("clears prior session prompt params when fallback has no effort fields", async () => {
    // given
    const sessionID = "ses_model_fallback_clear_effort"
    const input = { sessionID } as ChatMessageInput
    const output = {
      message: {
        model: { providerID: "xai", modelID: "grok-4.5" },
        variant: "high",
      },
      parts: [],
    } as ChatMessageHandlerOutput
    const lastToastKey = new Map<string, string>()

    await applyFallbackToChatMessage({
      input,
      output,
      fallback: {
        providerID: "xai",
        modelID: "grok-4.5",
        variant: "high",
        reasoningEffort: "high",
      },
      lastToastKey,
    })
    expect(getSessionPromptParams(sessionID)?.options?.reasoningEffort).toBe("high")

    // when
    await applyFallbackToChatMessage({
      input,
      output,
      fallback: {
        providerID: "openai",
        modelID: "gpt-5.5",
        variant: "high",
      },
      lastToastKey,
    })

    // then
    expect(getSessionPromptParams(sessionID)).toBeUndefined()
  })
})
