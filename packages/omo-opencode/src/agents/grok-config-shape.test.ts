import { describe, expect, test } from "bun:test"
import { createSisyphusAgent, resolveSisyphusPromptFamily } from "./sisyphus-agent-factory"
import {
  createSisyphusJuniorAgentWithOverrides,
  getSisyphusJuniorPromptSource,
} from "./sisyphus-junior/agent"
import { createAtlasAgent } from "./atlas/agent"
import { getPrometheusPrompt } from "./prometheus/system-prompt"
import { applyOverrides } from "./builtin-agents/agent-overrides"

describe("Grok agent config shape", () => {
  test("#given xai/grok-4.5 #when creating Sisyphus #then uses grok family without Claude thinking", () => {
    // given
    const model = "xai/grok-4.5"

    // when
    const family = resolveSisyphusPromptFamily(model)
    const agent = createSisyphusAgent(model)

    // then
    expect(family).toBe("grok")
    expect(agent.model).toBe(model)
    expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBeUndefined()
    expect(agent.prompt).toContain("Grok Harness Overlay")
  })

  test("#given xai/grok-4.5 #when applying sisyphus reasoningEffort override #then override wins", () => {
    // given
    const model = "xai/grok-4.5"
    const agent = createSisyphusAgent(model)

    // when
    const merged = applyOverrides(agent, { reasoningEffort: "high" }, {})

    // then
    expect((merged as { reasoningEffort?: string }).reasoningEffort).toBe("high")
  })

  test("#given xai/grok-build-latest #when creating Sisyphus #then grok family without 4.5 harness overlay", () => {
    // given
    const model = "xai/grok-build-latest"

    // when
    const family = resolveSisyphusPromptFamily(model)
    const agent = createSisyphusAgent(model)

    // then
    expect(family).toBe("grok")
    expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBeUndefined()
    expect(agent.prompt).not.toContain("Grok Harness Overlay")
  })

  test("#given xai/grok-4.5 #when creating Sisyphus-Junior #then uses Grok body + overlay without GPT-5.5 identity", () => {
    // given
    const model = "xai/grok-4.5"

    // when
    const source = getSisyphusJuniorPromptSource(model)
    const agent = createSisyphusJuniorAgentWithOverrides({
      model,
      reasoningEffort: "high",
    })

    // then
    expect(source).toBe("grok")
    expect(agent.model).toBe(model)
    expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBe("high")
    expect(agent.prompt).toContain("Grok")
    expect(agent.prompt).toContain("Grok Sisyphus-Junior overlay")
    expect(agent.prompt).toContain("based on Grok")
    expect(agent.prompt).not.toContain("based on GPT-5.5")
  })

  test("#given xai/grok-4.3 #when creating Sisyphus-Junior #then neutralizes GPT-5.5 identity without 4.5 overlay", () => {
    // given
    const model = "xai/grok-4.3"

    // when
    const source = getSisyphusJuniorPromptSource(model)
    const agent = createSisyphusJuniorAgentWithOverrides({ model })

    // then
    expect(source).toBe("grok")
    expect(agent.prompt).toContain("based on Grok")
    expect(agent.prompt).not.toContain("based on GPT-5.5")
    expect(agent.prompt).not.toContain("Grok Sisyphus-Junior overlay")
  })

  test("#given openai/gpt-5.5 #when creating Sisyphus-Junior #then keeps GPT-5.5 identity", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const source = getSisyphusJuniorPromptSource(model)
    const agent = createSisyphusJuniorAgentWithOverrides({ model })

    // then
    expect(source).toBe("gpt-5-5")
    expect(agent.prompt).toContain("based on GPT-5.5")
    expect(agent.prompt).not.toContain("Grok Sisyphus-Junior overlay")
  })

  test("#given xai/grok-4.5 #when creating Atlas #then appends overlay without overriding effort", () => {
    // given
    const model = "xai/grok-4.5"

    // when
    const agent = createAtlasAgent({ model })

    // then
    expect(agent.prompt).toContain("Grok Atlas orchestration overlay")
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBeUndefined()
  })

  test("#given xai/grok-4.3 #when creating Atlas #then omits Grok Atlas orchestration overlay", () => {
    // given
    const model = "xai/grok-4.3"

    // when
    const agent = createAtlasAgent({ model })

    // then
    expect(agent.prompt).not.toContain("Grok Atlas orchestration overlay")
  })

  test("#given xai/grok-4.5 #when loading Prometheus #then process law is present", () => {
    // given
    const model = "xai/grok-4.5"

    // when
    const prompt = getPrometheusPrompt(model)

    // then
    expect(prompt).toContain("Grok Prometheus process law")
    expect(prompt).toContain("scaffold-plan.mjs")
  })

  test("#given grok-build-latest #when loading Prometheus #then process law is absent", () => {
    // given
    const model = "xai/grok-build-latest"

    // when
    const prompt = getPrometheusPrompt(model)

    // then
    expect(prompt).not.toContain("Grok Prometheus process law")
  })

  test("#given non-4.5 Grok ids #when creating Sisyphus #then family is grok without harness overlay", () => {
    // given
    const models = [
      "xai/grok-4.3",
      "xai/grok-build-0.1",
      "xai/grok-4-fast-non-reasoning",
    ] as const

    for (const model of models) {
      // when
      const family = resolveSisyphusPromptFamily(model)
      const agent = createSisyphusAgent(model)

      // then
      expect(family).toBe("grok")
      expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
      expect((agent as { reasoningEffort?: string }).reasoningEffort).toBeUndefined()
      expect(agent.prompt).not.toContain("Grok Harness Overlay")
    }
  })

  test("#given non-4.5 Grok ids #when loading Prometheus #then process law is absent", () => {
    // given
    const models = [
      "xai/grok-4.3",
      "xai/grok-build-0.1",
      "xai/grok-4-fast-non-reasoning",
    ] as const

    for (const model of models) {
      // when
      const prompt = getPrometheusPrompt(model)

      // then
      expect(prompt).not.toContain("Grok Prometheus process law")
      expect(prompt).not.toContain("Grok Harness Overlay")
    }
  })

  test("#given opencode/grok-4.5 #when creating Sisyphus #then routes as grok with overlay", () => {
    // given
    const model = "opencode/grok-4.5"

    // when
    const family = resolveSisyphusPromptFamily(model)
    const agent = createSisyphusAgent(model)

    // then
    expect(family).toBe("grok")
    expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBeUndefined()
    expect(agent.prompt).toContain("Grok Harness Overlay")
  })
})
