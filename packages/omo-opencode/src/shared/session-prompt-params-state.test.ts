/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import {
  clearAllSessionPromptParams,
  clearRuntimeFallbackPromptParams,
  clearSessionPromptParams,
  getSessionPromptParams,
  getRuntimeFallbackPromptParams,
  setRuntimeFallbackPromptParams,
  setSessionPromptParams,
} from "./session-prompt-params-state"

describe("session-prompt-params-state", () => {
  afterEach(() => {
    clearAllSessionPromptParams()
  })

  test("stores and returns prompt params by session", () => {
    //#given
    const sessionID = "ses_prompt_params"
    const params = {
      temperature: 0.4,
      topP: 0.7,
      maxOutputTokens: 4096,
      options: {
        reasoningEffort: "high",
      },
    }

    //#when
    setSessionPromptParams(sessionID, params)

    //#then
    expect(getSessionPromptParams(sessionID)).toEqual(params)
  })

  test("returns copies so callers cannot mutate stored state", () => {
    //#given
    const sessionID = "ses_prompt_params_copy"
    setSessionPromptParams(sessionID, {
      temperature: 0.2,
      options: { reasoningEffort: "medium" },
    })

    //#when
    const result = getSessionPromptParams(sessionID)
    expect(result).toBeDefined()
    if (!result) return
    result.temperature = 0.9
    expect(result.options).toBeDefined()
    if (!result.options) return
    result.options.reasoningEffort = "max"

    //#then
    expect(getSessionPromptParams(sessionID)).toEqual({
      temperature: 0.2,
      options: { reasoningEffort: "medium" },
    })
  })

  test("clears a single session", () => {
    //#given
    const sessionID = "ses_prompt_params_clear"
    setSessionPromptParams(sessionID, { topP: 0.5 })

    //#when
    clearSessionPromptParams(sessionID)

    //#then
    expect(getSessionPromptParams(sessionID)).toBeUndefined()
  })

  test("merges runtime fallback effort over base spawn params", () => {
    //#given
    const sessionID = "ses_prompt_params_runtime_overlay"
    setSessionPromptParams(sessionID, {
      temperature: 0.2,
      topP: 0.6,
      maxOutputTokens: 8192,
      options: {
        reasoningEffort: "high",
        thinking: { type: "disabled" },
      },
    })

    //#when
    setRuntimeFallbackPromptParams(sessionID, {
      options: { reasoningEffort: "low" },
    })

    //#then
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

  test("clears only runtime fallback params while preserving base spawn params", () => {
    //#given
    const sessionID = "ses_prompt_params_runtime_clear"
    const baseParams = {
      temperature: 0.4,
      options: { reasoningEffort: "high" },
    }
    setSessionPromptParams(sessionID, baseParams)
    setRuntimeFallbackPromptParams(sessionID, {
      options: { reasoningEffort: "low" },
    })

    //#when
    clearRuntimeFallbackPromptParams(sessionID)

    //#then
    expect(getRuntimeFallbackPromptParams(sessionID)).toBeUndefined()
    expect(getSessionPromptParams(sessionID)).toEqual(baseParams)
  })
})
