import { describe, expect, test } from "bun:test"
import { createSisyphusAgent, resolveSisyphusPromptFamily } from "./sisyphus-agent-factory"
import {
  createSisyphusJuniorAgentWithOverrides,
  getSisyphusJuniorPromptSource,
} from "./sisyphus-junior/agent"

describe("Grok agent config shape", () => {
  test("#given xai/grok-4.5 #when creating Sisyphus #then uses grok family without Claude thinking", () => {
    const model = "xai/grok-4.5"
    expect(resolveSisyphusPromptFamily(model)).toBe("grok")
    const agent = createSisyphusAgent(model)
    expect(agent.model).toBe(model)
    expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBe("medium")
  })

  test("#given xai/grok-4.5 #when creating Sisyphus-Junior #then uses reasoningEffort without Claude thinking", () => {
    const model = "xai/grok-4.5"
    // Junior still uses default (Claude-style) prompt body until a dedicated Grok prompt exists.
    expect(getSisyphusJuniorPromptSource(model)).toBe("default")
    const agent = createSisyphusJuniorAgentWithOverrides({
      model,
      reasoningEffort: "high",
    })
    expect(agent.model).toBe(model)
    expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
    expect((agent as { reasoningEffort?: string }).reasoningEffort).toBe("high")
  })

  test("#given opencode/grok-4.5 and grok-4.3 #then Sisyphus routes as grok", () => {
    for (const model of ["opencode/grok-4.5", "xai/grok-4.3", "xai/grok-build-0.1"]) {
      expect(resolveSisyphusPromptFamily(model)).toBe("grok")
      const agent = createSisyphusAgent(model)
      expect((agent as { thinking?: unknown }).thinking).toBeUndefined()
      expect((agent as { reasoningEffort?: string }).reasoningEffort).toBe("medium")
    }
  })
})
