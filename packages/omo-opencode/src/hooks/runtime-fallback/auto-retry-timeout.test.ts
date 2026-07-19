import { afterEach, describe, expect, test } from "bun:test"

import { createFallbackTimeoutHelpers } from "./auto-retry-timeout"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig } from "../../config"

function createContext(): RuntimeFallbackPluginInput {
  return {
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
  }
}

function createDeps(): HookDeps {
  return {
    ctx: createContext(),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: true,
      restore_primary_after_cooldown: false,
    },
    options: {
      session_timeout_ms: 1,
    },
    pluginConfig: unsafeTestValue<OhMyOpenCodeConfig>({
      categories: {
        test: {
          fallback_models: ["litellm/openai.eu.gpt-5.5", "google/gemini-2.5-pro"],
        },
      },
    }),
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

describe("createFallbackTimeoutHelpers", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
  })

  test("#given timeout fallback dispatch is blocked #when the timeout fires #then fallback state is restored", async () => {
    // given
    const sessionID = "session-timeout-dispatch-blocked"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    const state = createFallbackState("openai/gpt-5.4")
    deps.sessionStates.set(sessionID, state)

    let retrySelection: { selectedIndex: number; model: string } | undefined
    let resolveRetry: (() => void) | undefined
    const retryCalled = new Promise<void>((resolve) => {
      resolveRetry = resolve
    })
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {},
      async (_sessionID, selectedFallback) => {
        retrySelection = {
          selectedIndex: selectedFallback.selectedIndex,
          model: selectedFallback.entry.model,
        }
        resolveRetry?.()
        return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
      },
    )

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await Promise.race([
      retryCalled,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timer did not fire")), 1000)
      }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))

    // then
    expect(retrySelection).toEqual({
      selectedIndex: 0,
      model: "litellm/openai.eu.gpt-5.5",
    })
    expect(state.currentModel).toBe("openai/gpt-5.4")
    expect(state.fallbackIndex).toBe(-1)
    expect(state.attemptCount).toBe(0)
    expect(state.pendingFallbackModel).toBe(undefined)
    expect(state.failedModels.size).toBe(0)
  })

  test("#given an accepted fallback is awaiting its result #when timeout escalation is blocked #then the restored awaiting state keeps a timeout armed", async () => {
    // given
    const sessionID = "session-timeout-awaiting-dispatch-blocked"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.options = {
      session_timeout_ms: 1,
    }
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "litellm/openai.eu.gpt-5.5"
    state.fallbackIndex = 0
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)

    let resolveRetry: (() => void) | undefined
    const retryCalled = new Promise<void>((resolve) => {
      resolveRetry = resolve
    })
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {},
      async () => {
        resolveRetry?.()
        return { accepted: false, status: "blocked", reason: "test gate blocked dispatch" }
      },
    )

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await Promise.race([
      retryCalled,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timer did not fire")), 1000)
      }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))

    // then
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(true)
    helpers.clearSessionFallbackTimeout(sessionID)
  })

  test("#given duplicate fallback entries and a blocked timeout escalation #when timeout state is restored and retried #then index one remains selectable with its own effort", async () => {
    // given
    const sessionID = "session-timeout-duplicate-settings"
    SessionCategoryRegistry.register(sessionID, "test")
    const deps = createDeps()
    deps.pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({
      categories: {
        test: {
          fallback_models: [
            { model: "xai/grok-4.5", reasoningEffort: "low" },
            { model: "xai/grok-4.5", reasoningEffort: "high" },
          ],
        },
      },
    })
    const state = createFallbackState("openai/gpt-5.4")
    state.currentModel = "xai/grok-4.5"
    state.fallbackIndex = 0
    state.selectedFallback = {
      selectedIndex: 0,
      entry: { model: "xai/grok-4.5", reasoningEffort: "low" },
    }
    state.failedModels.set("-1:openai/gpt-5.4", Date.now())
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const retrySelections: Array<{ selectedIndex: number; reasoningEffort: string | undefined }> = []
    let retryCount = 0
    let resolveRetries: (() => void) | undefined
    const retriesCalled = new Promise<void>((resolve) => {
      resolveRetries = resolve
    })
    const helpers = createFallbackTimeoutHelpers(
      deps,
      async () => {},
      async (_sessionID, selectedFallback) => {
        retryCount += 1
        retrySelections.push({
          selectedIndex: selectedFallback.selectedIndex,
          reasoningEffort: selectedFallback.entry.reasoningEffort,
        })
        if (retryCount === 2) {
          resolveRetries?.()
        }
        return retryCount === 1
          ? { accepted: false, status: "blocked", reason: "test restore" }
          : { accepted: true, status: "dispatched" }
      },
    )

    // when
    helpers.scheduleSessionFallbackTimeout(sessionID)
    await retriesCalled
    await new Promise((resolve) => setTimeout(resolve, 0))

    // then
    expect(retrySelections).toEqual([
      { selectedIndex: 1, reasoningEffort: "high" },
      { selectedIndex: 1, reasoningEffort: "high" },
    ])
    expect(state.selectedFallback?.selectedIndex).toBe(1)
    expect(state.selectedFallback?.entry.reasoningEffort).toBe("high")
  })
})
