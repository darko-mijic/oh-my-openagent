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

  test("keeps supplemental grok-4.5 context limit at official 500k", () => {
    // given
    const bundled = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)

    // when / then
    expect(bundled.models["xai/grok-4.5"]?.limit?.context).toBe(500_000)
    expect(bundled.models["grok-4.5"]?.limit?.context).toBe(500_000)
  })

  test("resolves opencode-go grok-4.5 context to 500k via bare-key snapshot fallback", () => {
    // given: OpenCode Go serves bare model IDs; supplemental pins bare grok-4.5 at 500k
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)

    // when: production capability lookup for opencode-go/grok-4.5
    const result = getModelCapabilities({
      providerID: "opencode-go",
      modelID: "grok-4.5",
      bundledSnapshot,
    })
    const contextLimit = bundledSnapshot.models[result.canonicalModelID]?.limit?.context

    // then: bare-key fallback yields official 500k context (no provider-prefixed supplemental required)
    expect(result.canonicalModelID).toBe("grok-4.5")
    expect(result.family).toBe("grok")
    expect(contextLimit).toBe(500_000)
    expect(result.diagnostics.snapshot.source).toBe("bundled-snapshot")
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
