import { realpathSync } from "node:fs"
import { getTrustedScaffoldRealpaths } from "./trusted-scaffold-paths"

const SHELL_METACHARACTER_PATTERN = /[;|`\n\r><&]/
const RUNTIME_PATTERN = /^(?:node|bun)(?:\.exe)?$/i
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/
const ALLOWED_FLAGS = new Set([
  "--clear",
  "--unclear",
  "--draft-only",
  "--review-required",
  "--reset",
  "--force",
])

export type PrometheusBashCommandPolicyOptions = {
  readonly trustedRealpaths?: ReadonlySet<string>
  readonly resolveRealpath?: (path: string) => string
}

function tokenizeCommand(command: string): readonly string[] | undefined {
  const tokens: string[] = []
  let index = 0

  while (index < command.length) {
    while (index < command.length && /\s/.test(command[index] ?? "")) {
      index += 1
    }
    if (index === command.length) {
      break
    }

    const firstCharacter = command[index]
    if (firstCharacter === '"' || firstCharacter === "'") {
      const closingQuote = command.indexOf(firstCharacter, index + 1)
      if (closingQuote === -1) {
        return undefined
      }
      tokens.push(command.slice(index + 1, closingQuote))
      index = closingQuote + 1
      if (index < command.length && !/\s/.test(command[index] ?? "")) {
        return undefined
      }
      continue
    }

    const tokenStart = index
    while (index < command.length && !/\s/.test(command[index] ?? "")) {
      if (command[index] === '"' || command[index] === "'") {
        return undefined
      }
      index += 1
    }
    tokens.push(command.slice(tokenStart, index))
  }

  return tokens
}

export function isAllowedPrometheusBashCommand(
  command: string,
  options: PrometheusBashCommandPolicyOptions = {},
): boolean {
  const trimmed = command.trim()
  if (
    trimmed.length === 0 ||
    command.includes("$") ||
    SHELL_METACHARACTER_PATTERN.test(command)
  ) {
    return false
  }

  const tokens = tokenizeCommand(trimmed)
  if (!tokens || tokens.length < 3) {
    return false
  }

  const runtime = tokens[0] ?? ""
  if (runtime.includes("/") || runtime.includes("\\") || !RUNTIME_PATTERN.test(runtime)) {
    return false
  }

  const script = tokens[1] ?? ""
  if (/^--?/.test(script)) {
    return false
  }

  const trustedRealpaths = options.trustedRealpaths ?? getTrustedScaffoldRealpaths()
  const resolveRealpath = options.resolveRealpath ?? realpathSync.native
  let scriptRealpath: string
  try {
    scriptRealpath = resolveRealpath(script)
  } catch (error) {
    if (error instanceof Error) {
      return false
    }
    throw error
  }
  if (!trustedRealpaths.has(scriptRealpath)) {
    return false
  }

  let slugCount = 0
  for (const argument of tokens.slice(2)) {
    if (ALLOWED_FLAGS.has(argument)) {
      continue
    }
    if (!SLUG_PATTERN.test(argument)) {
      return false
    }
    slugCount += 1
    if (slugCount > 1) {
      return false
    }
  }
  return slugCount === 1
}
