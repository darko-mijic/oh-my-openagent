#!/usr/bin/env node
import fs from "node:fs"
import http from "node:http"
import { sendSse, textEvents, toolCallEvents } from "./fake-openai-events.mjs"

const toolLog = process.env.FAKE_TOOL_CALL_LOG || ""
let callCount = 0

function hasToolResult(inputStr) {
  return (
    inputStr.includes('"type":"function_call_output"') ||
    inputStr.includes('"type": "function_call_output"') ||
    inputStr.includes('"type":"tool_result"') ||
    inputStr.includes('"type": "tool_result"') ||
    inputStr.includes('"role":"tool"') ||
    inputStr.includes('"role": "tool"')
  )
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function logTool(entry) {
  if (!toolLog) return
  fs.appendFileSync(toolLog, `${JSON.stringify(entry)}\n`)
}

function implPrompt() {
  return [
    "## 1. TASK",
    "Ordinary non-final-wave implementation work.",
    "",
    "Touch nothing. Reply DONE_IMPL when finished.",
  ].join("\n")
}

function f2Prompt() {
  return [
    "## 1. TASK",
    "F2. Code quality review",
    "",
    "Audit the implementation fidelity against the plan.",
    "End with a line-anchored VERDICT: APPROVE|REJECT.",
  ].join("\n")
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }
  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404).end("not found")
    return
  }
  callCount++
  const raw = await readBody(req)
  let body = {}
  try { body = JSON.parse(raw) } catch {}
  const inputStr = JSON.stringify(body.input ?? body.messages ?? body)
  const hasResult = hasToolResult(inputStr)

  if (inputStr.includes("Generate a title")) {
    return sendSse(res, textEvents(callCount, "todo15-no-regression"))
  }

  // Child sisyphus-junior / reviewer sessions
  if (
    inputStr.includes("Ordinary non-final-wave implementation") &&
    !inputStr.includes("NONF_CATEGORY_PROBE") &&
    !inputStr.includes("MARKED_REJECT_PROBE") &&
    !hasResult
  ) {
    logTool({ branch: "child-impl", call: callCount })
    return sendSse(res, textEvents(callCount, "DONE_IMPL\n"))
  }

  if (
    inputStr.includes("F2. Code quality review") &&
    !inputStr.includes("MARKED_REJECT_PROBE") &&
    !inputStr.includes("NONF_CATEGORY_PROBE") &&
    !hasResult
  ) {
    logTool({ branch: "child-reviewer", call: callCount })
    return sendSse(
      res,
      textEvents(callCount, "Reviewed.\nVERDICT: APPROVE\n"),
    )
  }

  if (inputStr.includes("NONF_CATEGORY_PROBE") && !hasResult) {
    const args = {
      description: "Ordinary impl category task",
      prompt: implPrompt(),
      category: "unspecified-high",
      load_skills: [],
      run_in_background: false,
    }
    logTool({ branch: "nonf-category", call: callCount, args })
    return sendSse(res, toolCallEvents(callCount, "task", `call_nonf_${callCount}`, args))
  }

  if (inputStr.includes("MARKED_REJECT_PROBE") && !hasResult) {
    const args = {
      description: "F2 category misroute",
      prompt: f2Prompt(),
      category: "unspecified-high",
      load_skills: [],
      run_in_background: false,
    }
    logTool({ branch: "marked-reject", call: callCount, args })
    return sendSse(res, toolCallEvents(callCount, "task", `call_reject_${callCount}`, args))
  }

  if (hasResult) {
    if (inputStr.includes("NONF_CATEGORY_PROBE")) {
      return sendSse(res, textEvents(callCount, "NONF_CATEGORY_DONE"))
    }
    if (inputStr.includes("MARKED_REJECT_PROBE")) {
      return sendSse(res, textEvents(callCount, "MARKED_REJECT_DONE"))
    }
    return sendSse(res, textEvents(callCount, "PROBE_DONE"))
  }

  return sendSse(res, textEvents(callCount, `fake response ${callCount}`))
})

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port
  process.stdout.write(`fake-openai listening on ${port}\n`)
})
