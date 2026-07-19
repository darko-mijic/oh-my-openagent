import { describe, test, expect } from "bun:test"
import { buildRetryModelPayload } from "./retry-model-payload"

describe("buildRetryModelPayload", () => {
  test("should return undefined for empty model string", () => {
    // given
    const model = ""

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toBeUndefined()
  })

  test("should return undefined for model without provider prefix", () => {
    // given
    const model = "kimi-k2.5"

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toBeUndefined()
  })

  test("should parse provider and model ID", () => {
    // given
    const model = "chutes/kimi-k2.5"

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toEqual({
      model: { providerID: "chutes", modelID: "kimi-k2.5" },
    })
  })

  test("should include variant from model string", () => {
    // given
    const model = "anthropic/claude-sonnet-4-5 high"

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toEqual({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
      variant: "high",
      reasoningEffort: "high",
    })
  })

  test("should use agent variant when model string has no variant", () => {
    // given
    const model = "chutes/kimi-k2.5"
    const agentSettings = { variant: "max" }

    // when
    const result = buildRetryModelPayload(model, undefined, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "chutes", modelID: "kimi-k2.5" },
      variant: "max",
      reasoningEffort: "max",
    })
  })

  test("should prefer model string variant over agent variant", () => {
    // given
    const model = "anthropic/claude-sonnet-4-5 high"
    const agentSettings = { variant: "max" }

    // when
    const result = buildRetryModelPayload(model, undefined, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
      variant: "high",
      reasoningEffort: "high",
    })
  })

  test("should include reasoningEffort from agent settings", () => {
    // given
    const model = "openai/gpt-5.4"
    const agentSettings = { variant: "high", reasoningEffort: "xhigh" }

    // when
    const result = buildRetryModelPayload(model, undefined, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "openai", modelID: "gpt-5.4" },
      variant: "high",
      reasoningEffort: "xhigh",
    })
  })

  test("should derive reasoningEffort from agent variant when explicit effort is absent", () => {
    // given
    const model = "chutes/kimi-k2.5"
    const agentSettings = { variant: "medium" }

    // when
    const result = buildRetryModelPayload(model, undefined, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "chutes", modelID: "kimi-k2.5" },
      variant: "medium",
      reasoningEffort: "medium",
    })
  })

  test("should default reasoningEffort high for xai/grok-4.5 with empty agent settings", () => {
    // given
    const model = "xai/grok-4.5"
    const agentSettings = {}

    // when
    const result = buildRetryModelPayload(model, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "xai", modelID: "grok-4.5" },
      reasoningEffort: "high",
    })
  })

  test("#given selected Grok fallback effort is low #when agent effort is high #then selected effort wins", () => {
    // given
    const model = "xai/grok-4.5"
    const selectedEntry = { reasoningEffort: "low" as const }
    const agentSettings = { reasoningEffort: "high" }

    // when
    const result = buildRetryModelPayload(model, selectedEntry, agentSettings)

    // then
    expect(result).toEqual({
      model: { providerID: "xai", modelID: "grok-4.5" },
      reasoningEffort: "low",
    })
  })

  test("#given Grok fallback has a low inline variant #when payload is built #then low is preserved and high is not injected", () => {
    // given
    const model = "xai/grok-4.5(low)"

    // when
    const result = buildRetryModelPayload(model)

    // then
    expect(result).toEqual({
      model: { providerID: "xai", modelID: "grok-4.5" },
      variant: "low",
      reasoningEffort: "low",
    })
  })

  test("#given grok-build-latest without effort #when payload is built #then Grok 4.5 high default is not applied", () => {
    // given
    const model = "xai/grok-build-latest"

    // when
    const result = buildRetryModelPayload(model, {})

    // then
    expect(result).toEqual({
      model: { providerID: "xai", modelID: "grok-build-latest" },
    })
  })

  test("should not default reasoningEffort high for non-4.5 Grok models", () => {
    // given
    const models = [
      "xai/grok-4.3",
      "xai/grok-build-0.1",
      "xai/grok-4-fast-non-reasoning",
    ] as const

    for (const model of models) {
      // when
      const result = buildRetryModelPayload(model, {})

      // then
      expect(result?.reasoningEffort).toBeUndefined()
      expect(result?.model.providerID).toBe("xai")
    }
  })
})
