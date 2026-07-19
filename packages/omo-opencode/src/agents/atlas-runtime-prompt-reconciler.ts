import { getAtlasPromptSource, type AtlasPromptSource } from "./atlas/agent"
import { isGrok45Model } from "./types"

/**
 * Context captured at Atlas registration so the per-request system-transform
 * hook can rebuild the prompt for the model actually selected at runtime.
 *
 * - `bakedPrompt` is the exact prompt string registered (body + overrides),
 *   used to locate the entry to replace in the runtime system array.
 * - `rebuildPromptForModel` re-runs the same registration pipeline with a
 *   different model, so overrides / prompt_append are preserved.
 */
export type AtlasRuntimePromptContext = {
  configuredModel: string
  bakedPrompt: string
  rebuildPromptForModel: (runtimeModel: string) => string
}

/**
 * Atlas prompt identity for runtime reconciliation.
 * Matches `getAtlasPromptSource` routing, plus a distinct `grok` family when
 * `isGrok45Model` applies the Grok orchestration overlay on top of the source body.
 */
export type AtlasPromptFamily = AtlasPromptSource | "grok"

export function resolveAtlasPromptFamily(model: string): AtlasPromptFamily {
  if (isGrok45Model(model)) return "grok"
  return getAtlasPromptSource(model)
}

let context: AtlasRuntimePromptContext | undefined

export function setAtlasRuntimePromptContext(ctx: AtlasRuntimePromptContext): void {
  context = ctx
}

export function clearAtlasRuntimePromptContext(): void {
  context = undefined
}

/**
 * The Atlas prompt body is baked at registration from the *configured* model
 * in `oh-my-openagent.jsonc`. When the user switches to a different model family
 * in the TUI, the entire baked body is the wrong family for the runtime model
 * (including the Grok overlay path). Rebuild the whole prompt for the runtime
 * family and swap it in here rather than patching individual overlay lines.
 *
 * Returns true if a swap was performed.
 */
export function reconcileAtlasRuntimePrompt(
  system: string[],
  runtimeModel: string | undefined,
): boolean {
  if (!runtimeModel || !context) return false

  // Same family => the baked body already matches the runtime model; leave it.
  if (
    resolveAtlasPromptFamily(runtimeModel) ===
    resolveAtlasPromptFamily(context.configuredModel)
  ) {
    return false
  }

  const rebuilt = context.rebuildPromptForModel(runtimeModel)
  if (rebuilt === context.bakedPrompt) return false

  // Substring replace rather than exact-equality: opencode core may concatenate
  // the agent prompt with other system text in a single array entry, so match
  // the baked body wherever it appears.
  let swapped = false
  for (let i = 0; i < system.length; i++) {
    const part = system[i]
    if (part.includes(context.bakedPrompt)) {
      system[i] = part.split(context.bakedPrompt).join(rebuilt)
      swapped = true
    }
  }
  return swapped
}
