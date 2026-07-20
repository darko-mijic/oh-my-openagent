import type { PluginInput } from "@opencode-ai/plugin"

import { getAgentFromSession } from "../prometheus-md-only/agent-resolution"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { isQaExecutorCommand } from "./qa-command-policy"
import { createQaPathPolicy } from "./qa-path-policy"

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

function isQaWritablePath(filePath: string, projectRoot: string, worktree: string): boolean {
  return createQaPathPolicy(projectRoot, worktree).isWritablePath(filePath)
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
        if (filePath === undefined || !isQaWritablePath(filePath, ctx.directory, worktree)) {
          throw new Error("[reviewer-scope-guard] qa-executor writes are limited to .omo/evidence/**, worktree evidence/**, or OS temp.")
        }
        return
      }

      if (!BASH_TOOLS.has(tool)) {
        return
      }

      const command = readBashCommand(output.args)
      if (command.length === 0 || (role === "read-only" && (command.includes("$") || SHELL_METACHARACTERS.test(command)))) {
        throw new Error(role === "read-only"
          ? "[reviewer-scope-guard] read-only grammar denied this Bash command."
          : "[reviewer-scope-guard] qa-executor Bash is limited to the QA allowlist.")
      }

      const worktree = await getSessionWorktree(ctx, input.sessionID)
      const tokens = role === "read-only" ? tokenizeCommand(command.trim()) : undefined
      const allowed = role === "read-only"
        ? tokens !== undefined && isReadOnlyReviewerCommand(tokens)
        : isQaExecutorCommand(command, ctx.directory, worktree)
      if (!allowed) {
        throw new Error(role === "read-only"
          ? "[reviewer-scope-guard] read-only grammar denied this Bash command."
          : "[reviewer-scope-guard] qa-executor Bash is limited to the QA allowlist.")
      }
    },
  }
}
