function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model
}

export function isGptModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("gpt")
}

export function isClaudeOpus46Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-opus-4-6")
}

export function isClaudeOpus47Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-opus-4-7")
}

export function isClaudeOpus48Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-opus-4-8")
}

export function isClaudeOpus5Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-opus-5")
}

export function isClaudeFable5Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return modelName.includes("claude-fable-5")
}

const CLAUDE_OPUS_VERSION_RE = /claude-opus-(\d+)(?:-(\d+))?/

/**
 * Claude Fable shares the Opus 4.7+ request surface (adaptive thinking only,
 * explicit enabled-thinking budgets rejected), so it counts as "4.7 or later".
 */
export function isClaudeOpus47OrLaterModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  if (modelName.includes("claude-fable")) return true
  const match = CLAUDE_OPUS_VERSION_RE.exec(modelName)
  if (!match) return false
  const major = Number(match[1])
  const minor = match[2] === undefined ? 0 : Number(match[2])
  if (Number.isNaN(major) || Number.isNaN(minor)) return false
  return major > 4 || (major === 4 && minor >= 7)
}

/**
 * Claude Fable / Mythos family (e.g. claude-fable-5, claude-mythos-5,
 * claude-mythos-preview). Like Opus 4.7+, these are adaptive-only: they reject
 * thinking.type "enabled" with a 400 and require adaptive thinking + effort,
 * which OpenCode core derives from the model variant.
 */
const CLAUDE_FABLE_OR_MYTHOS_RE = /claude-(?:fable|mythos)-(?:\d+|preview)/

export function isClaudeFableOrMythosModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  return CLAUDE_FABLE_OR_MYTHOS_RE.test(modelName)
}

export function isKimiK2Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  if (modelName.includes("kimi")) return true
  if (/k2[-.]?p[567]/.test(modelName)) return true
  return false
}

export function isKimiK27Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  if (/kimi-k2[.\-]?7/.test(modelName)) return true
  if (/k2[-.]?p7/.test(modelName)) return true
  return false
}

export function isKimiK3Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  if (/kimi-k3/.test(modelName)) return true
  if (/k3[-.]?p?\d*$/.test(modelName)) return true
  return false
}

export function isMiniMaxModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("minimax")
}

export function isGlmModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("glm")
}

/**
 * Grok / xAI family (e.g. xai/grok-4.5, opencode/grok-4.5, gateway renames
 * that keep "grok" in the model id). Provider-agnostic: match the model name.
 */
export function isGrokModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase()
  return modelName.includes("grok")
}

const GROK_MULTI_AGENT_RE = /grok-.*multi-agent/i
const GROK_45_RE = /grok-4-5(?:$|[^0-9])/
const GROK_45_ALIASES = new Set(["grok-4-5-latest"])

/**
 * Grok multi-agent SKUs (e.g. grok-4.20-multi-agent, grok-4.5-multi-agent).
 * Checked before isGrok45 so multi-agent never inherits 4.5-only overlays.
 */
export function isGrokMultiAgentModel(model: string): boolean {
  const modelName = extractModelName(model)
  return GROK_MULTI_AGENT_RE.test(modelName)
}

/**
 * Grok 4.5 family plus official alias grok-4.5-latest (normalized grok-4-5-latest).
 * Multi-agent and non-reasoning SKUs are excluded even when they embed "4.5" / "4-5".
 */
export function isGrok45Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-")
  if (modelName.includes("multi-agent")) return false
  if (modelName.includes("non-reasoning")) return false
  if (GROK_45_ALIASES.has(modelName)) return true
  return GROK_45_RE.test(modelName)
}

const GEMINI_PROVIDERS = ["google/", "google-vertex/"] as const

export function isGeminiModel(model: string): boolean {
  if (GEMINI_PROVIDERS.some((prefix) => model.startsWith(prefix))) return true

  if (
    model.startsWith("github-copilot/") &&
    extractModelName(model).toLowerCase().startsWith("gemini")
  )
    return true

  const modelName = extractModelName(model).toLowerCase()
  return modelName.startsWith("gemini-")
}
