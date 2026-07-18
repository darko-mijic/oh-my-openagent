import { describe, expect, test } from "bun:test"
import { createSisyphusAgent, resolveSisyphusPromptFamily } from "./sisyphus-agent-factory"
import {
  createSisyphusJuniorAgentWithOverrides,
  getSisyphusJuniorPromptSource,
} from "./sisyphus-junior/agent"
import { createAtlasAgent } from "./atlas/agent"
import { getPrometheusPrompt } from "./prometheus/system-prompt"

describe("Grok agent config shape", () => {
  test("#given xai/grok-4.5 #when creating Sisyphus #then uses grok family without Claude thinking", () => {
    const model = "xai/grok-4.5"
    expect(resolveSisyphusPromptFamily(model)).toBe("grok")
    const agent = createSisyphusAgent(model)
    expect(agent.model).toBe(model)
    expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBe("medium")
    expect(agent.prompt).toContain("Grok Harness Overlay")
  })

  test("#given xai/grok-4.5 #when creating Sisyphus-Junior #then uses Grok body + reasoningEffort", () => {
    const model = "xai/grok-4.5"
    expect(getSisyphusJuniorPromptSource(model)).toBe("grok")
    const agent = createSisyphusJuniorAgentWithOverrides({
      model,
      reasoningEffort: "high",
    })
    expect(agent.model).toBe(model)
    expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBe("high")
    expect(agent.prompt).toContain("Grok Sisyphus-Junior overlay")
  })

  test("#given xai/grok-4.5 #when creating Atlas #then appends orchestration overlay", () => {
    const model = "xai/grok-4.5"
    const agent = createAtlasAgent({ model })
    expect(agent.prompt).toContain("Grok Atlas orchestration overlay")
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBe("medium")
  })

  test("#given xai/grok-4.5 #when loading Prometheus #then process law is present", () => {
    const prompt = getPrometheusPrompt("xai/grok-4.5")
    expect(prompt).toContain("Grok Prometheus process law")
    expect(prompt).toContain("scaffold-plan.mjs")
  })

  test("#given opencode/grok-4.5 and grok-4.3 #then Sisyphus routes as grok", () => {
    for (const model of ["opencode/grok-4.5", "xai/grok-4.3", "xai/grok-build-0.1"]) {
      expect(resolveSisyphusPromptFamily(model)).toBe("grok")
      const agent = createSisyphusAgent(model)
      expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
      expect((agent as { reasoningEffort?: string }).reasoningEffort).toBe("medium")
      expect(agent.prompt).toContain("Grok Harness Overlay")
    }
  })
})
