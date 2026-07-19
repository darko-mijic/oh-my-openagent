/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  createFallbackState,
  findNextAvailableFallback,
  prepareFallback,
  stringifyRuntimeModelWithVariant,
} from "./fallback-state"

describe("runtime-fallback fallback state", () => {
  test("#given object-shaped current model #when finding the next fallback #then equivalent models are skipped without crashing", () => {
    // given
    const state = createFallbackState({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    const fallbackModels = ["github-copilot/claude-sonnet-4.6", "openai/gpt-5.4"]

    // when
    const nextModel = findNextAvailableFallback(state, fallbackModels, 60)

    // then
    expect(nextModel).toEqual({
      selectedIndex: 1,
      entry: { model: "openai/gpt-5.4" },
    })
  })

  test("#given model object without variant and top-level variant #when stringifying runtime model #then top-level variant is preserved", () => {
    // given
    const model = { providerID: "github-copilot", modelID: "claude-haiku-4.5" }

    // when
    const runtimeModel = stringifyRuntimeModelWithVariant(model, "high")

    // then
    expect(runtimeModel).toBe("github-copilot/claude-haiku-4.5(high)")
  })

  test("#given model object with its own variant #when stringifying with a top-level variant #then model variant wins", () => {
    // given
    const model = { providerID: "github-copilot", modelID: "claude-haiku-4.5", variant: "low" }

    // when
    const runtimeModel = stringifyRuntimeModelWithVariant(model, "high")

    // then
    expect(runtimeModel).toBe("github-copilot/claude-haiku-4.5(low)")
  })

  test("#given exact duplicate fallback models with distinct effort #when the first entry fails #then selection advances by index to the second entry", () => {
    // given
    const state = createFallbackState("openai/gpt-5.4")
    const fallbackModels = [
      { model: "xai/grok-4.5", reasoningEffort: "low" as const },
      { model: "xai/grok-4.5", reasoningEffort: "high" as const },
    ]
    const config = {
      enabled: true,
      retry_on_errors: [429],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    }

    // when
    const first = prepareFallback("session-duplicate", state, fallbackModels, config)
    state.pendingFallback = undefined
    const second = prepareFallback("session-duplicate", state, fallbackModels, config)

    // then
    expect(first.selectedFallback).toEqual({
      selectedIndex: 0,
      entry: fallbackModels[0],
    })
    expect(second.selectedFallback).toEqual({
      selectedIndex: 1,
      entry: fallbackModels[1],
    })
    expect(state.failedModels.has("0:xai/grok-4.5")).toBe(true)
  })
})
