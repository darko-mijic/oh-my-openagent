import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, BLOCKED_TOOLS, PLANNING_CONSULT_WARNING, PLANNING_CONTEXT_OPEN, PROMETHEUS_WORKFLOW_REMINDER } from "./constants"
import { log } from "../../shared/logger"
import { replaceToolArgs } from "../../shared/replace-tool-args"
import { getAgentFromSession } from "./agent-resolution"
import { isPrometheusAgent } from "./agent-matcher"
import { isAllowedPrometheusBashCommand } from "./bash-command-policy"
import { isAllowedFile } from "./path-policy"

const TASK_TOOLS = ["task", "call_omo_agent"]
const BASH_TOOLS = ["bash", "Bash"]

function readBashCommand(args: Record<string, unknown>): string {
  const command = args.command ?? args.cmd
  return typeof command === "string" ? command : ""
}

export function createPrometheusMdOnlyHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)

      if (!isPrometheusAgent(agentName)) {
        return
      }

      const toolName = input.tool

      // Defense-in-depth: pattern bash allow is not enough against chained commands.
      if (BASH_TOOLS.includes(toolName)) {
        const command = readBashCommand(output.args)
        if (!isAllowedPrometheusBashCommand(command)) {
          log(`[${HOOK_NAME}] Blocked: Prometheus bash outside scaffold-plan.mjs allowlist`, {
            sessionID: input.sessionID,
            tool: toolName,
            agent: agentName,
            command,
          })
          throw new Error(
            `[${HOOK_NAME}] Prometheus bash is restricted to node|bun invocations of scaffold-plan.mjs only ` +
              `(ulw-plan plan scaffold). No other shell commands are allowed. ` +
              `Attempted command: ${command || "(empty)"}.`,
          )
        }
        return
      }

      // Inject planning-only warning for task tools called by Prometheus
       if (TASK_TOOLS.includes(toolName)) {
         // Hard ban: category= spawns implementers (Junior). Observed Grok failure mode.
         const categoryArg = output.args.category
         if (typeof categoryArg === "string" && categoryArg.trim().length > 0) {
           log(`[${HOOK_NAME}] Blocked: Prometheus must not use task(category=...)`, {
             sessionID: input.sessionID,
             tool: toolName,
             agent: agentName,
             category: categoryArg,
           })
           throw new Error(
             `[${HOOK_NAME}] Prometheus must not use task(category="${categoryArg}"). ` +
             `Categories spawn implementers (Sisyphus-Junior). Allowed subagents only: ` +
             `explore, librarian, metis, momus, oracle (review). ` +
             `For drafts/plans run ulw-plan scaffold-plan.mjs — never category scaffolding.`,
           )
         }

         const prompt = output.args.prompt as string | undefined
         if (prompt && !prompt.includes(PLANNING_CONTEXT_OPEN)) {
           replaceToolArgs(output, { prompt: PLANNING_CONSULT_WARNING + prompt })
          log(`[${HOOK_NAME}] Injected planning warning to ${toolName}`, {
            sessionID: input.sessionID,
            tool: toolName,
            agent: agentName,
          })
        }
        return
      }

      if (!BLOCKED_TOOLS.includes(toolName)) {
        return
      }

      const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
      if (!filePath) {
        return
      }

       if (!isAllowedFile(filePath, ctx.directory)) {
         log(`[${HOOK_NAME}] Blocked: Prometheus can only write to .omo/*.md`, {
           sessionID: input.sessionID,
           tool: toolName,
           filePath,
           agent: agentName,
         })
         throw new Error(
           `[${HOOK_NAME}] Prometheus is a planning agent. File operations restricted to .omo/*.md plan files only. ` +
           `Do NOT route this change through a subagent either - delegated implementation is still implementation. ` +
           `Record the intended change as a todo in the plan; implementation starts only when the user runs /start-work. ` +
           `Attempted to modify: ${filePath}.`
         )
       }

      const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/")
      if (normalizedPath.includes(".omo/plans/") || normalizedPath.includes(".omo\\plans\\")) {
        log(`[${HOOK_NAME}] Injecting workflow reminder for plan write`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath,
          agent: agentName,
        })
        output.message = (output.message || "") + PROMETHEUS_WORKFLOW_REMINDER
      }

      log(`[${HOOK_NAME}] Allowed: .omo/*.md write permitted`, {
        sessionID: input.sessionID,
        tool: toolName,
        filePath,
        agent: agentName,
      })
    },
  }
}
