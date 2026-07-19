/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { readRuntimeModelThinkingSupport } from "./model-capabilities/runtime-model-readers"

describe("readRuntimeModelThinkingSupport", () => {
  test("#given conflicting non-Grok metadata #when thinking support is read #then explicit thinking wins over reasoning", () => {
    // given
    const runtimeModel = {
      reasoning: true,
      thinking: false,
    }

    // when
    const support = readRuntimeModelThinkingSupport(runtimeModel)

    // then
    expect(support).toEqual({
      value: false,
      source: "explicit-thinking",
    })
  })
})
