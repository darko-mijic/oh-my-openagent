import fs from "node:fs"
import http from "node:http"

const port = Number(process.argv[2] ?? 0)
const logPath = process.argv[3]
if (!logPath) throw new Error("usage: fake-openai-capture.mjs <port> <sanitized-log-path>")

let requestCount = 0
let grokFailures = 0

function record(value) {
  fs.appendFileSync(logPath, `${JSON.stringify(value)}\n`)
}

function hasLowEffort(value) {
  if (!value || typeof value !== "object") return false
  if (Array.isArray(value)) return value.some(hasLowEffort)
  return Object.entries(value).some(([key, child]) =>
    /effort/i.test(key) && child === "low" || hasLowEffort(child),
  )
}

function sendText(res, text) {
  const id = `resp_${requestCount}`
  const item = `msg_${requestCount}`
  const usage = {
    input_tokens: 10,
    output_tokens: 5,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  }
  const events = [
    { type: "response.created", response: { id, created_at: Math.floor(Date.now() / 1000), model: "qa-fake" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: item } },
    { type: "response.output_text.delta", item_id: item, output_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: item } },
    { type: "response.completed", response: { usage } },
  ]
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" })
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
  res.end("data: [DONE]\n\n")
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }

  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
    return
  }

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  const serialized = JSON.stringify(body)
  requestCount += 1
  const model = typeof body.model === "string" ? body.model : "unknown"
  const isGrok = model.includes("grok-4.5")
  record({
    type: "model-request",
    request: requestCount,
    model,
    grokAtlasOverlay: serialized.includes("Grok Atlas orchestration overlay"),
    lowEffort: hasLowEffort(body),
  })

  if (isGrok && grokFailures++ === 0) {
    res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "QA rate limit", type: "rate_limit_error" } }))
    return
  }

  sendText(res, "QA_FALLBACK_OK")
})

server.listen(port, "127.0.0.1", () => {
  const address = server.address()
  if (typeof address !== "object" || address === null) throw new Error("missing listening address")
  console.log(`PORT=${address.port}`)
})

process.on("SIGTERM", () => server.close(() => process.exit(0)))
process.on("SIGINT", () => server.close(() => process.exit(0)))
