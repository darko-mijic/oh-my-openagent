const SHELL_METACHARACTER_PATTERN = /[;|`\n\r]|&&|\|\||\$\(/

const RUNTIME_BASENAME_PATTERN = /^(?:node|bun)(?:\.exe)?$/i

const SCAFFOLD_SCRIPT_PATTERN = /(?:^|[/\\])scaffold-plan\.mjs$/i

function stripWrappingQuotes(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1)
  }
  return token
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  const tokenPattern = /"[^"]*"|'[^']*'|\S+/g
  for (const match of command.matchAll(tokenPattern)) {
    tokens.push(match[0] ?? "")
  }
  return tokens.filter((token) => token.length > 0)
}

function runtimeBasename(token: string): string {
  const unquoted = stripWrappingQuotes(token).replace(/\\/g, "/")
  const segments = unquoted.split("/")
  return segments[segments.length - 1] ?? unquoted
}

function isScaffoldScriptToken(token: string): boolean {
  const unquoted = stripWrappingQuotes(token).replace(/\\/g, "/")
  return SCAFFOLD_SCRIPT_PATTERN.test(unquoted)
}

/**
 * Defense-in-depth allowlist for Prometheus bash.
 * OpenCode pattern permissions may still admit broader matches; this gate
 * accepts only a single node|bun invocation of scaffold-plan.mjs with no
 * shell metacharacters.
 */
export function isAllowedPrometheusBashCommand(command: string): boolean {
  const trimmed = command.trim()
  if (trimmed.length === 0) {
    return false
  }

  if (SHELL_METACHARACTER_PATTERN.test(trimmed)) {
    return false
  }

  const tokens = tokenizeCommand(trimmed)
  if (tokens.length < 2) {
    return false
  }

  const runtime = runtimeBasename(tokens[0] ?? "")
  if (!RUNTIME_BASENAME_PATTERN.test(runtime)) {
    return false
  }

  return tokens.slice(1).some(isScaffoldScriptToken)
}
