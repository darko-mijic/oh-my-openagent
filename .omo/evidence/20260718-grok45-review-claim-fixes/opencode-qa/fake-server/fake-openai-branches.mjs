export function hasToolResult(inputStr) {
  return (
    inputStr.includes('"type":"function_call_output"') ||
    inputStr.includes('"type": "function_call_output"') ||
    inputStr.includes('"type":"tool_result"') ||
    inputStr.includes('"type": "tool_result"') ||
    inputStr.includes('"role":"tool"') ||
    inputStr.includes('"role": "tool"')
  )
}
export function selectBranch(inputStr) {
  if (inputStr.includes("Generate a title")) return "title"
  const hasResult = hasToolResult(inputStr)
  if (inputStr.includes("PROMETHEUS_BASH_DENY_PROBE") && !hasResult) return "prom-deny"
  if (inputStr.includes("PROMETHEUS_BASH_ALLOW_PROBE") && !hasResult) return "prom-allow"
  if (inputStr.includes("PROMETHEUS_BASH_DISABLED_HOOK_PROBE") && !hasResult) return "prom-disabled"
  if (hasResult) return "prom-done"
  return "default"
}
