import { createQaPathPolicy, type QaPathPolicy } from "./qa-path-policy"
import { tokenizeQaCommand } from "./qa-command-tokenizer"

const QA_ENV_KEYS = new Set([
  "TMPDIR", "TEMP", "TMP",
  "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME",
  "CODEX_HOME", "CI", "OPENCODE_DISABLE_AUTOUPDATE", "OPENCODE_DISABLE_MODELS_FETCH",
  "OMO_DISABLE_POSTHOG", "OMO_SEND_ANONYMOUS_TELEMETRY",
  "OMO_CODEX_DISABLE_POSTHOG", "OMO_CODEX_SEND_ANONYMOUS_TELEMETRY",
])
const QA_ENV_VALUE_PATTERN = /^[A-Za-z0-9_./,:@%+=-]*$/
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "log", "diff", "status", "show", "rev-parse", "check-ignore", "ls-files",
])
const READ_ONLY_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "grep", "rg", "sg", "diff", "wc",
  "sha256sum", "shasum", "realpath", "readlink", "dirname", "basename",
  "which", "uname", "df", "du", "ps",
])
const SAFE_TMUX_SUBCOMMANDS = new Set([
  "new-session", "new-window", "split-window", "send-keys", "capture-pane",
  "list-sessions", "list-windows", "list-panes", "has-session", "select-pane",
  "select-window", "resize-pane", "kill-pane", "kill-window", "kill-session",
  "display-message", "set-option", "set-window-option", "wait-for",
])
const SAFE_OPENCODE_SUBCOMMANDS = new Set(["run", "serve", "db", "export", "models", "version"])
const FORBIDDEN_NODE_FLAGS = new Set(["-e", "--eval", "--input-type"])
const UNSAFE_FIND_PREFIXES = ["-exec", "-ok", "-delete", "-fprint", "-fls"] as const

type QaCommandContext = {
  readonly paths: QaPathPolicy
  readonly tokens: readonly string[]
}

function stripEnvironmentAssignments(tokens: readonly string[]): readonly string[] | undefined {
  let commandIndex = 0
  while (commandIndex < tokens.length) {
    const assignment = tokens[commandIndex] ?? ""
    const separator = assignment.indexOf("=")
    if (separator < 1) {
      break
    }
    const key = assignment.slice(0, separator)
    const value = assignment.slice(separator + 1)
    if (!QA_ENV_KEYS.has(key) || !QA_ENV_VALUE_PATTERN.test(value)) {
      return undefined
    }
    commandIndex += 1
  }
  return commandIndex < tokens.length ? tokens.slice(commandIndex) : undefined
}

function hasForbiddenNodeFlag(tokens: readonly string[]): boolean {
  return tokens.some((token) => FORBIDDEN_NODE_FLAGS.has(token)
    || token.startsWith("--eval=")
    || token.startsWith("--input-type="))
}

function isGitCommand({ paths, tokens }: QaCommandContext): boolean {
  const subcommand = tokens[1]
  if (subcommand !== undefined && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return !tokens.slice(2).some((token) => token === "--output" || token.startsWith("--output="))
  }
  if (subcommand !== "worktree") {
    return false
  }

  const operation = tokens[2]
  if (operation === "list" || operation === "prune") {
    return true
  }
  if (operation !== "add" && operation !== "remove") {
    return false
  }

  const optionsWithValues = new Set(operation === "add" ? ["-b", "-B", "--reason"] : [])
  const allowedOptions = new Set(operation === "add"
    ? ["-f", "--force", "--detach", "--checkout", "--no-checkout", "--lock"]
    : ["-f", "--force"])
  let index = 3
  while (index < tokens.length) {
    const token = tokens[index] ?? ""
    if (optionsWithValues.has(token)) {
      index += 2
      continue
    }
    if (allowedOptions.has(token)) {
      index += 1
      continue
    }
    if (token.startsWith("-")) {
      return false
    }
    return paths.isCreationTarget(token)
  }
  return false
}

function isMkdirCommand({ paths, tokens }: QaCommandContext): boolean {
  const targets = tokens.slice(1).filter((token) => token !== "-p" && token !== "--parents")
  return targets.length > 0
    && targets.every((target) => !target.startsWith("-") && paths.isCreationTarget(target))
}

function isBunCommand({ paths, tokens }: QaCommandContext): boolean {
  if (hasForbiddenNodeFlag(tokens) || tokens.some((token) => token === "--preload" || token.startsWith("--preload="))) {
    return false
  }
  const subcommand = tokens[1]
  if (subcommand === "test") {
    return tokens.slice(2).every(paths.isTestPath)
  }
  if (subcommand === "run") {
    const script = tokens[2]
    return script !== undefined && /^[A-Za-z0-9:_.-]+$/.test(script)
  }
  return subcommand === "install" && tokens.slice(2).every((token) => token.startsWith("-"))
}

function isNodeCommand({ paths, tokens }: QaCommandContext): boolean {
  if (hasForbiddenNodeFlag(tokens)) {
    return false
  }
  if (tokens[1] === "--test") {
    const testPaths = tokens.slice(2)
    return testPaths.length > 0 && testPaths.every(paths.isTrustedScript)
  }
  const script = tokens[1]
  return script !== undefined && paths.isTrustedScript(script)
}

function isShellScriptCommand({ paths, tokens }: QaCommandContext): boolean {
  const script = tokens[1]
  return script !== undefined
    && script !== "-c"
    && script !== "--command"
    && paths.isTrustedScript(script)
}

function isFindCommand(tokens: readonly string[]): boolean {
  return !tokens.some((token) => UNSAFE_FIND_PREFIXES.some((prefix) => token.startsWith(prefix)))
}

function isCurlCommand({ paths, tokens }: QaCommandContext): boolean {
  let outputPath: string | undefined
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ""
    if (token === "-d" || token.startsWith("-d") || token.startsWith("--data") || token === "-F" || token.startsWith("--form")) {
      return false
    }
    if (token === "-X" || token === "--request") {
      const method = tokens[index + 1]?.toUpperCase()
      if (method === undefined || ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
        return false
      }
      index += 1
      continue
    }
    if (token.startsWith("--request=")) {
      const method = token.slice("--request=".length).toUpperCase()
      if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
        return false
      }
    }
    if (token.startsWith("-X") && ["POST", "PUT", "DELETE", "PATCH"].includes(token.slice(2).toUpperCase())) {
      return false
    }
    if (token === "-o" || token === "--output") {
      outputPath = tokens[index + 1]
      if (outputPath === undefined) {
        return false
      }
      index += 1
      continue
    }
    if (token.startsWith("--output=")) {
      outputPath = token.slice("--output=".length)
    } else if (token.startsWith("-o") && token.length > 2) {
      outputPath = token.slice(2)
    }
  }
  return outputPath === undefined || paths.isCreationTarget(outputPath)
}

function isSqliteCommand(tokens: readonly string[]): boolean {
  const databasePath = tokens[1] ?? ""
  if (tokens.length !== 3 || databasePath.startsWith("-")) {
    return false
  }
  const query = tokens[2] ?? ""
  return /^SELECT\b/i.test(query.trim())
    && !/\b(?:INSERT|UPDATE|DELETE|PRAGMA|ATTACH|DROP|CREATE)\b/i.test(query)
    && !/\b(?:load_extension|writefile)\s*\(/i.test(query)
}

function isQaSegmentAllowed(tokens: readonly string[], paths: QaPathPolicy): boolean {
  const commandTokens = stripEnvironmentAssignments(tokens)
  if (commandTokens === undefined) {
    return false
  }
  const context = { paths, tokens: commandTokens }
  const command = commandTokens[0]
  if (command === "git") return isGitCommand(context)
  if (command === "mkdir") return isMkdirCommand(context)
  if (command === "bun") return isBunCommand(context)
  if (command === "node") return isNodeCommand(context)
  if (command === "bash" || command === "sh") return isShellScriptCommand(context)
  if (command === "find") return isFindCommand(commandTokens)
  if (command === "curl") return isCurlCommand(context)
  if (command === "sqlite3") return isSqliteCommand(commandTokens)
  if (command === "tmux") return commandTokens[1] !== undefined && SAFE_TMUX_SUBCOMMANDS.has(commandTokens[1])
  if (command === "opencode") return commandTokens[1] !== undefined && SAFE_OPENCODE_SUBCOMMANDS.has(commandTokens[1])
  if (command === "env") return commandTokens.slice(1).every((token) => token.startsWith("-"))
  if (command === "sg") return READ_ONLY_COMMANDS.has(command)
    && !commandTokens.some((token) => token === "-r"
      || token === "--rewrite"
      || token.startsWith("--rewrite=")
      || token === "--update-all"
      || token === "--interactive")
  return command !== undefined && READ_ONLY_COMMANDS.has(command)
}

export function isQaExecutorCommand(command: string, projectRoot: string, worktree: string): boolean {
  const segments = tokenizeQaCommand(command.trim())
  if (segments === undefined) {
    return false
  }
  const paths = createQaPathPolicy(projectRoot, worktree)
  return segments.every((segment) => isQaSegmentAllowed(segment, paths))
}
