/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { getPrometheusPrompt } from "./system-prompt"

const MODEL_IDS = [
  undefined,
  "anthropic/claude-opus-4-8",
  "anthropic/claude-fable-5",
  "gpt-5.5",
  "gemini-3.1-pro",
  "opencode-go/kimi-k2.7",
] as const

const FORBIDDEN_PROMPT_FRAGMENTS = [
  ["<self", "_knowledge>"].join(""),
  ["Question", "({"].join(""),
] as const

describe("getPrometheusPrompt thin prompt contract", () => {
  describe("#given any supported model id", () => {
    describe("#when loading the Prometheus prompt", () => {
      it("#then names Prometheus as a planner that depends on the ulw-plan skill", () => {
        const prompt = getPrometheusPrompt(undefined, [])

        expect(prompt).toContain("You are Prometheus, a planning consultant")
        expect(prompt).toContain("You are a PLANNER")
        expect(prompt).toContain("ulw-plan skill")
        expect(prompt).toContain('skill(name="ulw-plan")')
      })

      it("#then closes the implement-by-proxy loophole for subagent dispatch", () => {
        const prompt = getPrometheusPrompt(undefined, [])

        expect(prompt).toContain("not directly and not by proxy")
        expect(prompt).toContain("no subagent you dispatch is ever that worker")
      })

      it("#then returns the same thin shell for non-Grok model families", () => {
        const prompts = MODEL_IDS.map((model) => getPrometheusPrompt(model, []))
        const [firstPrompt, ...remainingPrompts] = prompts

        expect(firstPrompt).toBeDefined()
        for (const prompt of remainingPrompts) {
          expect(prompt).toBe(firstPrompt)
        }
      })

      it("#then appends the Grok process overlay only for Grok 4.5 models", () => {
        // given
        const base = getPrometheusPrompt("anthropic/claude-opus-4-8", [])
        const grok45 = getPrometheusPrompt("xai/grok-4.5", [])
        const grokBuildLatest = getPrometheusPrompt("xai/grok-build-latest", [])
        const grok43 = getPrometheusPrompt("xai/grok-4.3", [])
        const grokBuild01 = getPrometheusPrompt("xai/grok-build-0.1", [])

        // then
        expect(grok45.startsWith(base)).toBe(true)
        expect(grok45).toContain("Grok Prometheus process law")
        expect(grok45).toContain("scaffold-plan.mjs")
        expect(grok45).toContain('Never `task(category=...)`')
        expect(grokBuildLatest).toContain("Grok Prometheus process law")
        expect(base).not.toContain("Grok Prometheus process law")
        expect(grok43).toBe(base)
        expect(grok43).not.toContain("Grok Prometheus process law")
        expect(grokBuild01).toBe(base)
        expect(grokBuild01).not.toContain("Grok Prometheus process law")
      })

      it("#then omits removed tuning and tool-example blocks", () => {
        const prompt = getPrometheusPrompt(undefined, [])

        for (const fragment of FORBIDDEN_PROMPT_FRAGMENTS) {
          expect(prompt).not.toContain(fragment)
        }
      })
    })
  })

  describe("#given the test imports the prompt loader", () => {
    describe("#when checking its own imports", () => {
      it("#then does not import the removed prompt source resolver", async () => {
        const removedExportName = ["get", "Prometheus", "Prompt", "Source"].join("")
        const testSource = await Bun.file(import.meta.path).text()
        const importLines = testSource
          .split("\n")
          .filter((line) => line.trimStart().startsWith("import "))

        expect(importLines.some((line) => line.includes(removedExportName))).toBe(false)
      })
    })
  })
})
