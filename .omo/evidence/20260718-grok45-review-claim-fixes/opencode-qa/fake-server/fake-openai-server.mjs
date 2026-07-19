#!/usr/bin/env node
import fs from "node:fs"
import http from "node:http"
import { sendSse, textEvents, toolCallEvents } from "./fake-openai-events.mjs"
import { selectBranch } from "./fake-openai-branches.mjs"
let callCount = 0
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
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
  const branch = selectBranch(inputStr)
  if (branch === "title") return sendSse(res, textEvents(callCount, "title"))
  if (branch === "prom-deny") {
    const cmd = process.env.PROBE_DENY_CMD
    if (!cmd) { res.writeHead(500).end("missing PROBE_DENY_CMD"); return }
    return sendSse(res, toolCallEvents(callCount, "bash", `call_deny_${callCount}`, { command: cmd }))
  }
  if (branch === "prom-allow") {
    const cmd = process.env.PROBE_ALLOW_CMD
    if (!cmd) { res.writeHead(500).end("missing PROBE_ALLOW_CMD"); return }
    fs.appendFileSync(process.env.FAKE_TOOL_CALL_LOG, `${JSON.stringify({ branch, command: cmd })}\n`)
    return sendSse(res, toolCallEvents(callCount, "bash", `call_allow_${callCount}`, { command: cmd }))
  }
  if (branch === "prom-disabled") {
    const cmd = process.env.PROBE_ALLOW_CMD
    if (!cmd) { res.writeHead(500).end("missing PROBE_ALLOW_CMD"); return }
    fs.appendFileSync(process.env.FAKE_TOOL_CALL_LOG, `${JSON.stringify({ branch, command: cmd })}\n`)
    return sendSse(res, toolCallEvents(callCount, "bash", `call_disabled_${callCount}`, { command: cmd }))
  }
  if (branch === "prom-done") return sendSse(res, textEvents(callCount, "PROBE_DONE"))
  return sendSse(res, textEvents(callCount, `fake response ${callCount}`))
})
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port
  process.stdout.write(`fake-openai listening on ${port}\n`)
})
