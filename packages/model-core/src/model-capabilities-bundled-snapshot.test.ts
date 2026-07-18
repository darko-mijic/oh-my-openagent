import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"
import bundledModelCapabilitiesSnapshotJson from "../../../packages/omo-opencode/src/generated/model-capabilities.generated.json"

describe("bundled model capabilities snapshot", () => {
  test("keeps GPT-4.1 OpenAI variants marked as supporting tool calls", () => {
    // given
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
    const modelIDs = [
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-nano",
    ]

    // when
    const results = modelIDs.map((modelID) =>
      getModelCapabilities({
        providerID: "openai",
        modelID,
        bundledSnapshot,
      }),
    )

    // then
    for (const result of results) {
      expect(result.toolCall).toBe(true)
      expect(result.diagnostics).toMatchObject({
        resolutionMode: "snapshot-backed",
        snapshot: { source: "bundled-snapshot" },
        toolCall: { source: "bundled-snapshot" },
      })
    }
  })

  test("keeps Grok reasoning true without Anthropic thinking support on production bundled path", () => {
    // given: supplemental grok-4.5 + catalog grok-4.3 mark reasoning-capable
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)

    for (const modelID of ["grok-4.5", "xai/grok-4.5", "grok-4.3"]) {
      // when
      const result = getModelCapabilities({
        providerID: "xai",
        modelID,
        bundledSnapshot,
      })

      // then: snapshot reasoning stays true, but Anthropic thinking stays off via Grok heuristic
      expect(result.family).toBe("grok")
      expect(result.reasoning).toBe(true)
      expect(result.supportsThinking).toBe(false)
      expect(result.diagnostics.supportsThinking.source).toBe("heuristic")
      expect(result.reasoningEfforts).toEqual(["low", "medium", "high"])
    }
  })

  test("does not enable Anthropic thinking for Grok catalog entries on production bundled path", () => {
    // given
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)

    // when
    const result = getModelCapabilities({
      providerID: "xai",
      modelID: "xai/grok-4",
      bundledSnapshot,
    })

    // then
    expect(result.family).toBe("grok")
    expect(result.supportsThinking).toBe(false)
    expect(result.diagnostics.supportsThinking.source).toBe("heuristic")
  })
})
