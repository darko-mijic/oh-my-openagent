import { afterEach, describe, expect, test } from "bun:test"

import { createSystemTransformHandler } from "./system-transform"
import { createAtlasAgent } from "../agents/atlas"
import { GROK_ATLAS_ORCHESTRATION_OVERLAY } from "../agents/atlas/grok-overlay"
import { applyOverrides } from "../agents/builtin-agents/agent-overrides"
import {
  clearAtlasRuntimePromptContext,
  reconcileAtlasRuntimePrompt,
  resolveAtlasPromptFamily,
  setAtlasRuntimePromptContext,
} from "../agents/atlas-runtime-prompt-reconciler"
import type { AgentOverrideConfig } from "../agents/types"

const GPT_MODEL = "openai/gpt-5.5"
const NON_GPT_MODEL = "anthropic/claude-sonnet-4-6"
const GROK_MODEL = "xai/grok-4.5"
const PROMPT_APPEND_MARKER = "ATLAS_RUNTIME_PROMPT_APPEND_MARKER_TASK10"

function registerAtlas(model: string, override?: AgentOverrideConfig): string {
  let config = createAtlasAgent({ model })
  config = applyOverrides(config, override, {})
  const baked = config.prompt ?? ""
  setAtlasRuntimePromptContext({
    configuredModel: config.model ?? model,
    bakedPrompt: baked,
    rebuildPromptForModel: (runtimeModel) => {
      let rebuilt = createAtlasAgent({ model: runtimeModel })
      rebuilt = applyOverrides(rebuilt, override, {})
      return rebuilt.prompt ?? ""
    },
  })
  return baked
}

afterEach(() => {
  clearAtlasRuntimePromptContext()
})

describe("Atlas runtime prompt family reconciliation", () => {
  test("#given a GPT-configured Atlas body #when run on a non-GPT model #then the WHOLE body is rebuilt for the runtime family", () => {
    const baked = registerAtlas(GPT_MODEL)
    expect(resolveAtlasPromptFamily(GPT_MODEL)).toBe("gpt")
    expect(resolveAtlasPromptFamily(NON_GPT_MODEL)).toBe("default")

    const system = [baked]
    const swapped = reconcileAtlasRuntimePrompt(system, NON_GPT_MODEL)

    expect(swapped).toBe(true)
    expect(system[0]).toBe(createAtlasAgent({ model: NON_GPT_MODEL }).prompt)
    expect(system[0]).not.toBe(baked)
  })

  test("#given the baked body concatenated with other system text #when run on a non-GPT model #then only the body portion is rebuilt", () => {
    const baked = registerAtlas(GPT_MODEL)
    const system = [`<context>\n${baked}\n</context>`]

    const swapped = reconcileAtlasRuntimePrompt(system, NON_GPT_MODEL)

    expect(swapped).toBe(true)
    expect(system[0]).toContain("<context>")
    expect(system[0]).toContain("</context>")
    expect(system[0]).toContain(createAtlasAgent({ model: NON_GPT_MODEL }).prompt ?? "")
    expect(system[0]).not.toContain(baked)
  })

  test("#given a GPT-configured body #when run on the same GPT family #then the body is left untouched", () => {
    const baked = registerAtlas(GPT_MODEL)
    const system = [baked]
    const swapped = reconcileAtlasRuntimePrompt(system, GPT_MODEL)
    expect(swapped).toBe(false)
    expect(system[0]).toBe(baked)
  })

  test("#given no registered Atlas context #when reconcile runs #then it is a no-op", () => {
    const system = ["unrelated system prompt"]
    expect(reconcileAtlasRuntimePrompt(system, NON_GPT_MODEL)).toBe(false)
    expect(system).toEqual(["unrelated system prompt"])
  })

  test("#given a non-Atlas session #when reconcile runs #then nothing matches and nothing changes", () => {
    registerAtlas(GPT_MODEL)
    const system = ["some other agent's prompt with no Atlas body"]
    expect(reconcileAtlasRuntimePrompt(system, NON_GPT_MODEL)).toBe(false)
    expect(system).toEqual(["some other agent's prompt with no Atlas body"])
  })

  test("#given a non-Grok Atlas body #when runtime model is Grok 4.5 #then the rebuilt body includes the exported Grok Atlas overlay constant", () => {
    const baked = registerAtlas(NON_GPT_MODEL)
    expect(baked).not.toContain(GROK_ATLAS_ORCHESTRATION_OVERLAY)
    expect(resolveAtlasPromptFamily(GROK_MODEL)).toBe("grok")

    const system = [baked]
    const swapped = reconcileAtlasRuntimePrompt(system, GROK_MODEL)

    expect(swapped).toBe(true)
    expect(system[0]).toContain(GROK_ATLAS_ORCHESTRATION_OVERLAY)
    expect(system[0]).toBe(createAtlasAgent({ model: GROK_MODEL }).prompt)
  })

  test("#given prompt_append override on registration #when family switches #then rebuild retains the append content", () => {
    const override: AgentOverrideConfig = { prompt_append: PROMPT_APPEND_MARKER }
    const baked = registerAtlas(GPT_MODEL, override)
    expect(baked).toContain(PROMPT_APPEND_MARKER)

    const system = [baked]
    const swapped = reconcileAtlasRuntimePrompt(system, NON_GPT_MODEL)

    expect(swapped).toBe(true)
    expect(system[0]).toContain(PROMPT_APPEND_MARKER)
    const expected = applyOverrides(createAtlasAgent({ model: NON_GPT_MODEL }), override, {}).prompt
    expect(system[0]).toBe(expected)
  })

  test("#given the full system-transform handler #when runtime model is non-GPT #then the Atlas body is reconciled end-to-end", async () => {
    const baked = registerAtlas(GPT_MODEL)
    const handler = createSystemTransformHandler()
    const output = { system: [baked] }

    await handler(
      { sessionID: "s", model: { id: NON_GPT_MODEL, providerID: "anthropic" } },
      output,
    )

    expect(output.system[0]).toBe(createAtlasAgent({ model: NON_GPT_MODEL }).prompt)
  })

  test("#given the full system-transform handler #when runtime model is Grok 4.5 #then the Grok Atlas overlay constant is present", async () => {
    const baked = registerAtlas(NON_GPT_MODEL)
    const handler = createSystemTransformHandler()
    const output = { system: [baked] }

    await handler(
      { sessionID: "s", model: { id: GROK_MODEL, providerID: "xai" } },
      output,
    )

    expect(output.system[0]).toContain(GROK_ATLAS_ORCHESTRATION_OVERLAY)
  })
})
