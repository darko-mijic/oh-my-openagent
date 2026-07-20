import { tmpdir } from "node:os"
import { isAbsolute, relative, resolve } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { getAgentFromSession } from "../prometheus-md-only/agent-resolution"
import { getAgentConfigKey } from "../../shared/agent-display-names"

const FILE_WRITE_TOOLS = new Set(["write", "edit", "hashline_edit", "apply_patch"])
const BASH_TOOLS = new Set(["bash", "interactive_bash"])
const READ_ONLY_REVIEWERS = new Set(["momus", "oracle"])
const READ_ONLY_GIT_SUBCOMMANDS = new Set(["log", "diff", "status", "show"])
const READ_ONLY_COMMANDS = new Set(["ls", "grep", "rg", "sg", "cat", "head", "tail", "less", "more"])
const UNSAFE_FIND_TOKENS = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fls"])
const SHELL_METACHARACTERS = /[;|`\n\r><&]/

type ReviewerRole = "read-only" | "qa-executor" | undefined

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

    const quote = command[index]
    if (quote === "\"" || quote === "'") {
      const closingQuote = command.indexOf(quote, index + 1)
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

    const start = index
    while (index < command.length && !/\s/.test(command[index] ?? "")) {
      if (command[index] === "\"" || command[index] === "'") {
        return undefined
      }
      index += 1
    }
    tokens.push(command.slice(start, index))
  }

  return tokens
}

function isPathWithin(path: string, root: string): boolean {
  const relativePath = relative(root, path)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function readToolPath(args: Record<string, unknown>): string | undefined {
  const path = args.filePath ?? args.path ?? args.file ?? args.file_path
  return typeof path === "string" && path.length > 0 ? path : undefined
}

function readBashCommand(args: Record<string, unknown>): string {
  const command = args.command ?? args.cmd
  return typeof command === "string" ? command : ""
}

function reviewerRole(agent: string | undefined): ReviewerRole {
  const agentKey = agent === undefined ? undefined : getAgentConfigKey(agent)
  if (agentKey === "qa-executor") {
    return "qa-executor"
  }
  if (agentKey !== undefined && READ_ONLY_REVIEWERS.has(agentKey)) {
    return "read-only"
  }
  return undefined
}

function isReadOnlyReviewerCommand(tokens: readonly string[]): boolean {
  const command = tokens[0]
  if (command === "git") {
    return tokens.length >= 2 && READ_ONLY_GIT_SUBCOMMANDS.has(tokens[1] ?? "")
  }
  if (command === "find") {
    return !tokens.some((token) => UNSAFE_FIND_TOKENS.has(token))
  }
  return command !== undefined && READ_ONLY_COMMANDS.has(command)
}

function isQaTestPath(path: string, worktree: string): boolean {
  return !path.startsWith("-") && isPathWithin(resolve(worktree, path), worktree)
}

function isQaExecutorCommand(tokens: readonly string[], worktree: string): boolean {
  const command = tokens[0]
  if (command === "git") {
    return tokens.length >= 2 && READ_ONLY_GIT_SUBCOMMANDS.has(tokens[1] ?? "")
  }
  if (command === "bun") {
    return tokens[1] === "test" && tokens.slice(2).every((path) => isQaTestPath(path, worktree))
  }
  if (command === "node") {
    return tokens.length >= 3 && tokens[1] === "--test" && tokens.slice(2).every((path) => isQaTestPath(path, worktree))
  }
  return false
}

function isQaWritablePath(filePath: string, worktree: string): boolean {
  const resolvedPath = resolve(worktree, filePath)
  const resolvedWorktree = resolve(worktree)
  const omoEvidenceRoot = resolve(resolvedWorktree, ".omo", "evidence")
  const worktreeEvidenceRoot = resolve(resolvedWorktree, "evidence")
  const tempRoot = resolve(tmpdir())
  // Worktrees often live under OS temp (tests, disposable checkouts). Temp
  // allowance must not reopen the whole worktree for product writes.
  const isOutsideWorktreeTemp = isPathWithin(resolvedPath, tempRoot)
    && !isPathWithin(resolvedPath, resolvedWorktree)
  return isPathWithin(resolvedPath, omoEvidenceRoot)
    || isPathWithin(resolvedPath, worktreeEvidenceRoot)
    || isOutsideWorktreeTemp
}

async function getSessionWorktree(ctx: PluginInput, sessionID: string): Promise<string> {
  const session = await ctx.client.session.get({ path: { id: sessionID } }).catch(() => undefined)
  return session?.data?.directory ?? ctx.directory
}

export function createReviewerScopeGuardHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      const agent = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)
      const role = reviewerRole(agent)
      if (role === undefined) {
        return
      }

      const tool = input.tool.toLowerCase()
      if (FILE_WRITE_TOOLS.has(tool)) {
        if (role === "read-only") {
          throw new Error("[reviewer-scope-guard] read-only reviewer sessions cannot modify files.")
        }

        const filePath = readToolPath(output.args)
        const worktree = await getSessionWorktree(ctx, input.sessionID)
        if (filePath === undefined || !isQaWritablePath(filePath, worktree)) {
          throw new Error("[reviewer-scope-guard] qa-executor writes are limited to .omo/evidence/**, worktree evidence/**, or OS temp.")
        }
        return
      }

      if (!BASH_TOOLS.has(tool)) {
        return
      }

      const command = readBashCommand(output.args)
      if (command.length === 0 || command.includes("$") || SHELL_METACHARACTERS.test(command)) {
        throw new Error(role === "read-only"
          ? "[reviewer-scope-guard] read-only grammar denied this Bash command."
          : "[reviewer-scope-guard] qa-executor Bash is limited to the QA allowlist.")
      }

      const tokens = tokenizeCommand(command.trim())
      const worktree = await getSessionWorktree(ctx, input.sessionID)
      const allowed = tokens !== undefined && (role === "read-only"
        ? isReadOnlyReviewerCommand(tokens)
        : isQaExecutorCommand(tokens, worktree))
      if (!allowed) {
        throw new Error(role === "read-only"
          ? "[reviewer-scope-guard] read-only grammar denied this Bash command."
          : "[reviewer-scope-guard] qa-executor Bash is limited to the QA allowlist.")
      }
    },
  }
}
