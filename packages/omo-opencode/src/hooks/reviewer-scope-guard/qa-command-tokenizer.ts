const FORBIDDEN_SHELL_CHARACTERS = new Set([";", "|", "`", "\n", "\r", ">", "<", "$"])

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
