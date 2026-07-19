/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import { createChatMessageHandler } from "./chat-message-handler"
import { createFallbackState } from "./fallback-state"
import type { HookDeps } from "./types"
import {
  applyRuntimeFallbackPromptParams,
  applySessionPromptParams,
} from "../../shared/session-prompt-params-helpers"
import {
  clearAllSessionPromptParams,
  getSessionPromptParams,
} from "../../shared/session-prompt-params-state"

function createDeps(): HookDeps {
  return {
    ctx: {
      client: {
        session: {
          abort: async () => ({}),
          messages: async () => ({ data: [] }),
          promptAsync: async () => ({}),
        },
        tui: {
          showToast: async () => ({}),
        },
      },
      directory: "/test/dir",
    },
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 0,
      timeout_seconds: 30,
      notify_on_fallback: true,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: undefined,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

describe("createChatMessageHandler runtime fallback model override", () => {
  afterEach(() => {
    clearAllSessionPromptParams()
  })

  test("#given session is on an accepted fallback #when a later user message is transformed after cooldown #then it stays on the fallback model", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-active-fallback"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "litellm/openai.eu.gpt-5.5"
    state.fallbackIndex = 0
    state.failedModels.set("openai/gpt-5.4", Date.now() - 60_000)
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: { message: { model?: { providerID: string; modelID: string } } } = { message: {} }

    // when
    await handler(
      {
        sessionID,
        model: {
          providerID: "litellm",
          modelID: "openai.eu.gpt-5.5",
        },
      },
      output,
    )

    // then
    expect(output.message.model).toEqual({
      providerID: "litellm",
      modelID: "openai.eu.gpt-5.5",
    })
    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe("litellm/openai.eu.gpt-5.5")
  })

  test("#given an indexed fallback with variant and effort #when a subsequent turn is transformed #then model and variant are restored while effort is stored in session prompt params", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-fallback-settings"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "xai/grok-4.5(low)"
    state.fallbackIndex = 0
    state.selectedFallback = {
      selectedIndex: 0,
      entry: { model: "xai/grok-4.5", variant: "low", reasoningEffort: "low" },
    }
    deps.sessionStates.set(sessionID, state)
    const handler = createChatMessageHandler(deps)
    const output: { message: Record<string, unknown> } = { message: {} }

    // when
    await handler({
      sessionID,
      model: { providerID: "xai", modelID: "grok-4.5" },
    }, output)

    // then
    expect(output.message.model).toEqual({ providerID: "xai", modelID: "grok-4.5" })
    expect(output.message.variant).toBe("low")
    expect(output.message.reasoningEffort).toBeUndefined()
    expect(getSessionPromptParams(sessionID)?.options).toEqual({ reasoningEffort: "low" })
  })

  test("#given a delegated session has spawn params #when runtime fallback applies effort #then spawn params survive under the runtime effort", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-fallback-preserves-spawn-settings"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "xai/grok-4.5(low)"
    state.fallbackIndex = 0
    state.selectedFallback = {
      selectedIndex: 0,
      entry: { model: "xai/grok-4.5", variant: "low", reasoningEffort: "low" },
    }
    deps.sessionStates.set(sessionID, state)
    applySessionPromptParams(sessionID, {
      temperature: 0.2,
      top_p: 0.6,
      maxTokens: 8192,
      reasoningEffort: "high",
      thinking: { type: "disabled" },
    })
    const handler = createChatMessageHandler(deps)

    // when
    await handler({
      sessionID,
      model: { providerID: "xai", modelID: "grok-4.5" },
    }, { message: {} })

    // then
    expect(getSessionPromptParams(sessionID)).toEqual({
      temperature: 0.2,
      topP: 0.6,
      maxOutputTokens: 8192,
      options: {
        reasoningEffort: "low",
        thinking: { type: "disabled" },
      },
    })
  })

  test("#given runtime fallback effort was applied #when the user manually changes models #then stale session prompt params are cleared", async () => {
    // given
    const deps = createDeps()
    const sessionID = "session-manual-model-change"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "xai/grok-4.5(low)"
    state.fallbackIndex = 0
    state.selectedFallback = {
      selectedIndex: 0,
      entry: { model: "xai/grok-4.5", variant: "low", reasoningEffort: "low" },
    }
    state.runtimePromptParamsApplied = true
    deps.sessionStates.set(sessionID, state)
    applySessionPromptParams(sessionID, { temperature: 0.2 })
    applyRuntimeFallbackPromptParams(sessionID, { reasoningEffort: "low" })
    const handler = createChatMessageHandler(deps)

    // when
    await handler({
      sessionID,
      model: { providerID: "google", modelID: "gemini-2.5-pro" },
    }, { message: {} })

    // then
    expect(getSessionPromptParams(sessionID)).toEqual({ temperature: 0.2 })
  })

  test("#given runtime fallback effort was applied #when the primary model is restored #then stale session prompt params are cleared", async () => {
    // given
    const deps = createDeps()
    deps.config.restore_primary_after_cooldown = true
    const sessionID = "session-primary-restore"
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "xai/grok-4.5(high)"
    state.fallbackIndex = 0
    state.selectedFallback = {
      selectedIndex: 0,
      entry: { model: "xai/grok-4.5", variant: "high", reasoningEffort: "high" },
    }
    state.runtimePromptParamsApplied = true
    deps.sessionStates.set(sessionID, state)
    applySessionPromptParams(sessionID, { top_p: 0.6 })
    applyRuntimeFallbackPromptParams(sessionID, { reasoningEffort: "high" })
    const handler = createChatMessageHandler(deps)
    const output: { message: Record<string, unknown> } = { message: {} }

    // when
    await handler({
      sessionID,
      model: { providerID: "xai", modelID: "grok-4.5" },
    }, output)

    // then
    expect(output.message.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(getSessionPromptParams(sessionID)).toEqual({ topP: 0.6 })
  })
})
