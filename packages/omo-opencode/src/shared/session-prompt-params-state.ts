export type SessionPromptParams = {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  options?: Record<string, unknown>
}

const sessionPromptParams = new Map<string, SessionPromptParams>()
const runtimeFallbackPromptParams = new Map<string, SessionPromptParams>()

function copySessionPromptParams(params: SessionPromptParams): SessionPromptParams {
  return {
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.topP !== undefined ? { topP: params.topP } : {}),
    ...(params.maxOutputTokens !== undefined ? { maxOutputTokens: params.maxOutputTokens } : {}),
    ...(params.options !== undefined ? { options: { ...params.options } } : {}),
  }
}

export function setSessionPromptParams(sessionID: string, params: SessionPromptParams): void {
  sessionPromptParams.set(sessionID, copySessionPromptParams(params))
}

export function clearBaseSessionPromptParams(sessionID: string): void {
  sessionPromptParams.delete(sessionID)
}

export function setRuntimeFallbackPromptParams(
  sessionID: string,
  params: SessionPromptParams,
): void {
  runtimeFallbackPromptParams.set(sessionID, copySessionPromptParams(params))
}

export function getRuntimeFallbackPromptParams(
  sessionID: string,
): SessionPromptParams | undefined {
  const params = runtimeFallbackPromptParams.get(sessionID)
  return params ? copySessionPromptParams(params) : undefined
}

export function clearRuntimeFallbackPromptParams(sessionID: string): void {
  runtimeFallbackPromptParams.delete(sessionID)
}

export function getSessionPromptParams(sessionID: string): SessionPromptParams | undefined {
  const baseParams = sessionPromptParams.get(sessionID)
  const runtimeParams = runtimeFallbackPromptParams.get(sessionID)
  if (!baseParams && !runtimeParams) return undefined

  return {
    ...copySessionPromptParams(baseParams ?? {}),
    ...copySessionPromptParams(runtimeParams ?? {}),
    ...(
      baseParams?.options !== undefined || runtimeParams?.options !== undefined
        ? { options: { ...baseParams?.options, ...runtimeParams?.options } }
        : {}
    ),
  }
}

export function clearSessionPromptParams(sessionID: string): void {
  sessionPromptParams.delete(sessionID)
  runtimeFallbackPromptParams.delete(sessionID)
}

export function clearAllSessionPromptParams(): void {
  sessionPromptParams.clear()
  runtimeFallbackPromptParams.clear()
}
