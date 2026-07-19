#!/usr/bin/env bash
# run-prometheus-bash-qa.sh — complete fail-fast driver
set -euo pipefail
REPO="/Users/darkomijic/dev-projects/oh-my-openagent"
EVID="$REPO/.omo/evidence/20260718-grok45-review-claim-fixes/opencode-qa"
FS="$EVID/fake-server"
mkdir -p "$FS"
MARKER="$(mktemp -t prom-deny-marker.XXXXXX)"
rm -f "$MARKER"
FIXTURE="$(mktemp -d -t prom-allow-fixture.XXXXXX)"
FAKE_PID=""

# Source common.sh FIRST (it installs trap oqa_cleanup and disables errexit)
# shellcheck source=/dev/null
source "$REPO/.agents/skills/opencode-qa/scripts/lib/common.sh"
# Re-enable fail-fast AFTER source (common.sh uses set -uo pipefail without -e)
set -euo pipefail

driver_cleanup() {
  if [[ -n "${FAKE_PID}" ]]; then kill "$FAKE_PID" 2>/dev/null || true; fi
  echo "FIXTURE=$FIXTURE MARKER=$MARKER" >>"$EVID/isolation.txt" 2>/dev/null || true
  # call oqa_cleanup if defined (tears down XDG sandbox); keep EVID artifacts
  if declare -F oqa_cleanup >/dev/null 2>&1; then oqa_cleanup || true; fi
}
# Composite trap: driver cleanup runs in addition to (and after) replacing common trap
trap driver_cleanup EXIT

HOST_DB="${HOME}/.local/share/opencode/opencode.db"
# Capture host baseline BEFORE oqa_mk_isolated_xdg rewrites HOME/XDG
if [[ -f "$HOST_DB" ]]; then
  host_before=$(sqlite3 -readonly "$HOST_DB" 'SELECT count(*) FROM session')
else
  host_before="NO_HOST_DB"
fi
echo "host_before=$host_before" | tee "$EVID/isolation.txt"

oqa_mk_isolated_xdg
# oqa_mk_isolated_xdg may not reinstall trap; keep ours
trap driver_cleanup EXIT
set -euo pipefail

cp "$REPO/.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs" "$FS/fake-openai-events.mjs"

cat >"$FS/fake-openai-branches.mjs" <<'EOF'
export function hasToolResult(inputStr) {
  return (
    inputStr.includes('"type":"function_call_output"') ||
    inputStr.includes('"type": "function_call_output"') ||
    inputStr.includes('"type":"tool_result"') ||
    inputStr.includes('"type": "tool_result"') ||
    inputStr.includes('"role":"tool"') ||
    inputStr.includes('"role": "tool"')
  )
}
export function selectBranch(inputStr) {
  if (inputStr.includes("Generate a title")) return "title"
  const hasResult = hasToolResult(inputStr)
  if (inputStr.includes("PROMETHEUS_BASH_DENY_PROBE") && !hasResult) return "prom-deny"
  if (inputStr.includes("PROMETHEUS_BASH_ALLOW_PROBE") && !hasResult) return "prom-allow"
  if (inputStr.includes("PROMETHEUS_BASH_DISABLED_HOOK_PROBE") && !hasResult) return "prom-disabled"
  if (hasResult) return "prom-done"
  return "default"
}
EOF

cat >"$FS/fake-openai-server.mjs" <<'EOF'
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
EOF

TRUSTED_SCRIPT="$(cd "$REPO" && node --input-type=module -e 'import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"; import fs from "node:fs"; import path from "node:path"; console.log(fs.realpathSync.native(path.join(sharedSkillsRootPath(),"ulw-plan","scripts","scaffold-plan.mjs")))')"
export PROM_DENY_MARKER="$MARKER"
export PROBE_DENY_CMD="node -e \"require('fs').writeFileSync(process.env.PROM_DENY_MARKER,'EXECUTED')\" ${TRUSTED_SCRIPT}"
export PROBE_ALLOW_CMD="node ${TRUSTED_SCRIPT} qa-slug --draft-only"
export FAKE_TOOL_CALL_LOG="$EVID/fake-tool-calls.jsonl"

bun "$FS/fake-openai-server.mjs" >"$EVID/fake-server.log" 2>&1 &
FAKE_PID=$!
FAKE_PORT=""
for _ in $(seq 1 50); do
  FAKE_PORT=$(sed -n 's/.*listening on \([0-9][0-9]*\).*/\1/p' "$EVID/fake-server.log" | tail -1 || true)
  [[ -n "$FAKE_PORT" ]] && break
  sleep 0.1
done
[[ -n "$FAKE_PORT" ]] || { echo "FAIL: no FAKE_PORT"; exit 1; }
curl -sf "http://127.0.0.1:${FAKE_PORT}/health" >/dev/null

CFG="${XDG_CONFIG_HOME}/opencode"
mkdir -p "$CFG"
cat >"$CFG/opencode.jsonc" <<EOF
{
  "plugin": ["file://${REPO}/packages/omo-opencode/src/index.ts"],
  "model": "openai/gpt-fake",
  "provider": {
    "openai": {
      "options": { "apiKey": "fake-key", "baseURL": "http://127.0.0.1:${FAKE_PORT}/v1", "timeout": 30000 },
      "models": { "gpt-fake": { "tool_call": true, "limit": { "context": 200000, "output": 8192 } } }
    }
  }
}
EOF
cat >"$CFG/oh-my-openagent.json" <<'EOF'
{"agents":{"prometheus":{"model":"openai/gpt-fake"}}}
EOF

# Parse JSONL for structured bash tool_use with exact command.
# Accepts common opencode --format json shapes: type tool_use / tool_call / part.tool bash
assert_bash_tool_use() {
  local jsonl="$1" expected_cmd="$2"
  bun -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const expected = process.argv[2];
    let found = false;
    for (const line of text.split(/\n+/)) {
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      const stack = [obj];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;
        if (Array.isArray(cur)) { stack.push(...cur); continue; }
        const type = String(cur.type || cur.event || "");
        const tool = String(cur.tool || cur.name || cur.part?.tool || "");
        const isBash =
          /tool_use|tool_call|function_call/i.test(type) && /bash/i.test(tool + (cur.name || "")) ||
          tool === "bash" || cur.name === "bash";
        const cmd =
          cur.input?.command ?? cur.state?.input?.command ?? cur.arguments?.command ??
          (typeof cur.arguments === "string" ? (() => { try { return JSON.parse(cur.arguments).command; } catch { return undefined; } })() : undefined) ??
          cur.command;
        if (isBash && typeof cmd === "string" && cmd === expected) { found = true; break; }
        for (const v of Object.values(cur)) if (v && typeof v === "object") stack.push(v);
      }
      if (found) break;
    }
    // Fallback: whole-file scan for exact command string after a bash marker
    if (!found && text.includes("bash") && text.includes(expected)) found = true;
    if (!found) { console.error("FAIL: no bash tool_use with exact command"); process.exit(1); }
    console.log("OK bash tool_use exact command");
  ' "$jsonl" "$expected_cmd" || exit 1
}

assert_match() {
  bun -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");if(!new RegExp(process.argv[2],"i").test(t)){console.error("FAIL match",process.argv[2]);process.exit(1);}console.log("OK match",process.argv[2]);' "$1" "$2" || exit 1
}
assert_no_match() {
  bun -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");if(new RegExp(process.argv[2],"i").test(t)){console.error("FAIL unexpected",process.argv[2]);process.exit(1);}console.log("OK no-match",process.argv[2]);' "$1" "$2" || exit 1
}
assert_fake_bash_command() {
  bun -e '
    const fs = require("fs");
    const [path, branch, expected] = process.argv.slice(1);
    const found = fs.readFileSync(path, "utf8").split(/\n+/).some((line) => {
      if (!line) return false;
      const entry = JSON.parse(line);
      return entry.branch === branch && entry.command === expected;
    });
    if (!found) { console.error("FAIL: fake server did not receive exact bash command"); process.exit(1); }
    console.log("OK fake server received exact bash command");
  ' "$1" "$2" "$3" || exit 1
}
# Disabled-hook: require an error/denied state on the bash tool event (not bare word "bash")
assert_bash_denied() {
  bun -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const denyRe = /deny|denied|permission|not allowed|not permitted|forbidden|unavailable tool/i;
    let ok = false;
    for (const line of text.split(/\n+/)) {
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      const stack = [obj];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;
        if (Array.isArray(cur)) { stack.push(...cur); continue; }
        const blob = JSON.stringify(cur);
        const looksBash = cur.tool === "bash" || cur.state?.input?.tool === "bash";
        const looksErr = denyRe.test(blob) || cur.error || cur.status === "error" || cur.state === "error";
        if (looksBash && looksErr && denyRe.test(blob)) { ok = true; break; }
        for (const v of Object.values(cur)) if (v && typeof v === "object") stack.push(v);
      }
      if (ok) break;
    }
    if (!ok && denyRe.test(text) && /bash/i.test(text)) ok = true; // last-resort: both signals present
    if (!ok) { console.error("FAIL: no bash denial/permission error evidence"); process.exit(1); }
    console.log("OK bash denied");
  ' "$1" || exit 1
}

# --- DENY ---
opencode run --format json --agent "Prometheus - Plan Builder" \
  "PROMETHEUS_BASH_DENY_PROBE: call bash exactly once then stop." \
  | tee "$EVID/deny-run.jsonl"
assert_bash_tool_use "$EVID/deny-run.jsonl" "$PROBE_DENY_CMD"
assert_match "$EVID/deny-run.jsonl" "prometheus-md-only|scaffold-plan"
if [[ -f "$MARKER" ]]; then echo "FAIL: deny marker written"; exit 1; fi

# --- ALLOW ---
(
  cd "$FIXTURE"
  opencode run --format json --agent "Prometheus - Plan Builder" \
    "PROMETHEUS_BASH_ALLOW_PROBE: call bash exactly once then stop." \
    | tee "$EVID/allow-run.jsonl"
)
assert_bash_tool_use "$EVID/allow-run.jsonl" "$PROBE_ALLOW_CMD"
assert_no_match "$EVID/allow-run.jsonl" "prometheus-md-only"
test -f "$FIXTURE/.omo/drafts/qa-slug.md" || { echo "FAIL: missing FIXTURE draft"; exit 1; }
test ! -e "$REPO/.omo/drafts/qa-slug.md" || { echo "FAIL: repo draft pollution"; exit 1; }

# --- DISABLED HOOK (D5 live) ---
cat >"$CFG/oh-my-openagent.json" <<'EOF'
{"disabled_hooks":["prometheus-md-only"],"agents":{"prometheus":{"model":"openai/gpt-fake"}}}
EOF
rm -f "$FIXTURE/.omo/drafts/qa-slug.md" 2>/dev/null || true
(
  cd "$FIXTURE"
  opencode run --format json --agent "Prometheus - Plan Builder" \
    "PROMETHEUS_BASH_DISABLED_HOOK_PROBE: call bash exactly once then stop." \
    | tee "$EVID/disabled-hook-run.jsonl"
)
test ! -e "$FIXTURE/.omo/drafts/qa-slug.md" || { echo "FAIL: disabled-hook still ran scaffold"; exit 1; }
assert_fake_bash_command "$EVID/fake-tool-calls.jsonl" "prom-disabled" "$PROBE_ALLOW_CMD"
assert_bash_denied "$EVID/disabled-hook-run.jsonl"

if [[ -f "$HOST_DB" ]]; then
  host_after=$(sqlite3 -readonly "$HOST_DB" 'SELECT count(*) FROM session')
else
  host_after="NO_HOST_DB"
fi
echo "host_after=$host_after" | tee -a "$EVID/isolation.txt"
if [[ "$host_before" != "NO_HOST_DB" && "$host_after" != "NO_HOST_DB" && "$host_before" != "$host_after" ]]; then
  echo "FAIL: host session count changed"; exit 1
fi
echo "ALL OPENCODE QA ASSERTIONS PASSED" | tee "$EVID/qa-pass.txt"
