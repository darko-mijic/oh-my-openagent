/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import type { AutoRetryHelpers } from "./auto-retry"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import {
  clearAllSessionPromptParams,
  getRuntimeFallbackPromptParams,
  setRuntimeFallbackPromptParams,
  setSessionPromptParams,
} from "../../shared/session-prompt-params-state"

function createContext(toastMessages: string[]): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async (input) => {
          toastMessages.push(input.body.message)
          return {}
        },
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(toastMessages: string[]): HookDeps {
  return {
    ctx: createContext(toastMessages),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
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

function createRejectedDispatchHelpers(
  dispatchCalls: Array<{ selectedIndex: number; model: string }>,
  beforeReject?: () => void,
): AutoRetryHelpers {
  return {
    abortSessionRequest: async () => {},
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (_sessionID, selectedFallback) => {
      dispatchCalls.push({
        selectedIndex: selectedFallback.selectedIndex,
        model: selectedFallback.entry.model,
      })
      beforeReject?.()
      return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
    },
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

describe("dispatchFallbackRetry", () => {
  afterEach(() => {
    clearAllSessionPromptParams()
  })

  test("#given fallback dispatch is blocked #when fallback retry runs #then state is restored and no success toast is shown", async () => {
    // given
    const toastMessages: string[] = []
    const dispatchCalls: Array<{ selectedIndex: number; model: string }> = []
    const deps = createDeps(toastMessages)
    const helpers = createRejectedDispatchHelpers(dispatchCalls)
    const sessionID = "session-dispatch-rejected"
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)

    // when
    await dispatchFallbackRetry(deps, helpers, {
      sessionID,
      state,
      fallbackModels: ["litellm/openai.eu.gpt-5.5"],
      source: "message.updated",
    })

    // then
    expect(dispatchCalls).toEqual([{
      selectedIndex: 0,
      model: "litellm/openai.eu.gpt-5.5",
    }])
    expect(toastMessages).toEqual([])
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.fallbackIndex).toBe(-1)
    expect(state.attemptCount).toBe(0)
    expect(state.pendingFallbackModel).toBe(undefined)
    expect(state.failedModels.size).toBe(0)
  })

  test("#given fallback params are applied during dispatch #when dispatch is rejected #then the runtime overlay rolls back without changing base params", async () => {
    // given
    const toastMessages: string[] = []
    const dispatchCalls: Array<{ selectedIndex: number; model: string }> = []
    const deps = createDeps(toastMessages)
    const sessionID = "session-dispatch-params-rejected"
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    setSessionPromptParams(sessionID, {
      temperature: 0.2,
      options: { thinking: { type: "disabled" } },
    })
    const helpers = createRejectedDispatchHelpers(dispatchCalls, () => {
      setRuntimeFallbackPromptParams(sessionID, {
        options: { reasoningEffort: "high" },
      })
      state.runtimePromptParamsApplied = true
    })

    // when
    await dispatchFallbackRetry(deps, helpers, {
      sessionID,
      state,
      fallbackModels: [{ model: "xai/grok-4.5", reasoningEffort: "high" }],
      source: "session.error",
    })

    // then
    expect(getRuntimeFallbackPromptParams(sessionID)).toBeUndefined()
    expect(state.runtimePromptParamsApplied).toBe(false)
  })

  test("#given a newer fallback supersedes an in-flight dispatch #when the older dispatch is rejected #then the newer state and overlay remain", async () => {
    // given
    const toastMessages: string[] = []
    const deps = createDeps(toastMessages)
    const sessionID = "session-stale-dispatch-rejected"
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)
    const fallbackModels = [
      { model: "xai/grok-4.5", reasoningEffort: "low" },
      { model: "xai/grok-4.5", reasoningEffort: "high" },
    ] as const
    let releaseOlderDispatch: (() => void) | undefined
    let markOlderDispatchStarted: (() => void) | undefined
    const olderDispatchStarted = new Promise<void>((resolve) => {
      markOlderDispatchStarted = resolve
    })
    const olderHelpers = createRejectedDispatchHelpers([], () => {
      markOlderDispatchStarted?.()
    })
    olderHelpers.autoRetryWithFallback = async () => {
      markOlderDispatchStarted?.()
      await new Promise<void>((resolve) => {
        releaseOlderDispatch = resolve
      })
      return { accepted: false, status: "blocked", reason: "superseded dispatch" }
    }

    // when
    const olderDispatch = dispatchFallbackRetry(deps, olderHelpers, {
      sessionID,
      state,
      fallbackModels,
      source: "session.error",
    })
    await olderDispatchStarted
    await dispatchFallbackRetry(deps, {
      ...olderHelpers,
      autoRetryWithFallback: async () => {
        setRuntimeFallbackPromptParams(sessionID, {
          options: { reasoningEffort: "high" },
        })
        state.runtimePromptParamsApplied = true
        return { accepted: true, status: "dispatched" }
      },
    }, {
      sessionID,
      state,
      fallbackModels,
      source: "session.timeout",
    })
    releaseOlderDispatch?.()
    await olderDispatch

    // then
    expect(state.currentModel).toBe("xai/grok-4.5")
    expect(state.selectedFallback?.selectedIndex).toBe(1)
    expect(state.attemptCount).toBe(2)
    expect(getRuntimeFallbackPromptParams(sessionID)).toEqual({
      options: { reasoningEffort: "high" },
    })
  })
})
