const FORBIDDEN_SHELL_CHARACTERS = new Set([";", "|", "`", "\n", "\r", ">", "<", "$"])
const UNSAFE_FIND_PREFIXES = ["-exec", "-ok", "-delete", "-fprint", "-fls"] as const
const UNSAFE_SG_FLAGS = new Set(["-r", "--rewrite", "--update-all", "--interactive"])
const SAFE_CURL_FLAGS = new Set(["-s", "-S", "-sS", "-f", "--fail", "-L", "--location", "--compressed"])
const SAFE_CURL_VALUE_FLAGS = new Set([
  "-m", "--max-time", "--connect-timeout", "-H", "--header", "-A", "--user-agent", "--max-filesize",
])
const SAFE_CURL_LONG_VALUE_FLAGS = new Set([
  "--max-time", "--connect-timeout", "--header", "--user-agent", "--max-filesize",
])
const SAFE_CURL_REQUEST_METHODS = new Set(["GET", "HEAD"])
const SAFE_CURL_COMBINED_SHORT_FLAGS = /^-[fsSL]+$/

type SafeCurlCommand = {
  readonly outputPaths: readonly string[]
}

export function isReadOnlyFindCommand(tokens: readonly string[]): boolean {
  return !tokens.some((token) => UNSAFE_FIND_PREFIXES.some((prefix) => token.startsWith(prefix)))
}

export function isReadOnlySgCommand(tokens: readonly string[]): boolean {
  return !tokens.some((token) => UNSAFE_SG_FLAGS.has(token) || token.startsWith("--rewrite="))
}

export function inspectSafeCurlCommand(tokens: readonly string[]): SafeCurlCommand | undefined {
  const outputPaths: string[] = []
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ""
    if (!token.startsWith("-")) {
      continue
    }
    if (SAFE_CURL_FLAGS.has(token) || SAFE_CURL_COMBINED_SHORT_FLAGS.test(token)) {
      continue
    }
    if (SAFE_CURL_VALUE_FLAGS.has(token)) {
      const value = tokens[index + 1]
      if (value === undefined || ((token === "-H" || token === "--header") && value.startsWith("@"))) {
        return undefined
      }
      index += 1
      continue
    }

    const longValueSeparator = token.indexOf("=")
    if (longValueSeparator > 0) {
      const flag = token.slice(0, longValueSeparator)
      const value = token.slice(longValueSeparator + 1)
      if (SAFE_CURL_LONG_VALUE_FLAGS.has(flag) && value.length > 0) {
        if (flag === "--header" && value.startsWith("@")) {
          return undefined
        }
        continue
      }
    }
    if (token === "-o" || token === "--output") {
      const outputPath = tokens[index + 1]
      if (outputPath === undefined) {
        return undefined
      }
      outputPaths.push(outputPath)
      index += 1
      continue
    }
    if (token.startsWith("--output=")) {
      const outputPath = token.slice("--output=".length)
      if (outputPath.length === 0) {
        return undefined
      }
      outputPaths.push(outputPath)
      continue
    }
    if (token.startsWith("-o") && token.length > 2) {
      outputPaths.push(token.slice(2))
      continue
    }

    if (token === "-X" || token === "--request") {
      const method = tokens[index + 1]?.toUpperCase()
      if (method === undefined || !SAFE_CURL_REQUEST_METHODS.has(method)) {
        return undefined
      }
      index += 1
      continue
    }
    if (token.startsWith("--request=")) {
      if (!SAFE_CURL_REQUEST_METHODS.has(token.slice("--request=".length).toUpperCase())) {
        return undefined
      }
      continue
    }
    if (token.startsWith("-X") && token.length > 2) {
      if (!SAFE_CURL_REQUEST_METHODS.has(token.slice(2).toUpperCase())) {
        return undefined
      }
      continue
    }
    return undefined
  }
  return { outputPaths }
}

export function tokenizeQaCommand(command: string): readonly (readonly string[])[] | undefined {
  const segments: string[][] = [[]]
  let token = ""
  let index = 0

  const pushToken = (): void => {
    if (token.length > 0) {
      segments[segments.length - 1]?.push(token)
      token = ""
    }
  }

  while (index < command.length) {
    const character = command[index] ?? ""
    if (FORBIDDEN_SHELL_CHARACTERS.has(character)) {
      return undefined
    }
    if (character === "&") {
      if (command[index + 1] !== "&" || command[index + 2] === "&") {
        return undefined
      }
      pushToken()
      if ((segments[segments.length - 1]?.length ?? 0) === 0) {
        return undefined
      }
      segments.push([])
      index += 2
      continue
    }
    if (/\s/.test(character)) {
      pushToken()
      index += 1
      continue
    }
    if (character === "\"" || character === "'") {
      if (token.length > 0) {
        return undefined
      }
      const quote = character
      index += 1
      while (index < command.length && command[index] !== quote) {
        const quotedCharacter = command[index] ?? ""
        if (FORBIDDEN_SHELL_CHARACTERS.has(quotedCharacter) || quotedCharacter === "&") {
          return undefined
        }
        token += quotedCharacter
        index += 1
      }
      if (command[index] !== quote) {
        return undefined
      }
      index += 1
      if (index < command.length && !/\s/.test(command[index] ?? "") && command[index] !== "&") {
        return undefined
      }
      pushToken()
      continue
    }
    token += character
    index += 1
  }

  pushToken()
  return segments.every((segment) => segment.length > 0) ? segments : undefined
}
