#!/usr/bin/env bash
# Isolated OpenCode real-harness QA for final-wave reviewer gate enforcement (Todo 13).
# Proves: (1) marked+category F launch rejected at tool.execute.before
#         (2) correctly-routed F completion writes durable receipt
#         (3) legacy-unmarked plan keeps old behavior (no rejection)
#         (4) host opencode.db session count unchanged
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EVID="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$EVID"
rm -f "$EVID"/{isolation.txt,qa-pass.txt,qa-failure.txt,server-health.json,agent-list.json}
rm -f "$EVID"/{reject-run.jsonl,receipt-run.jsonl,legacy-run.jsonl}
rm -f "$EVID"/{reject-sse.jsonl,receipt-sse.jsonl,legacy-sse.jsonl}
rm -f "$EVID"/{reject-message.txt,receipt-sidecar.json,legacy-no-rejection.txt,fake-server.log,opencode-serve.log}
rm -f "$EVID"/fake-tool-calls.jsonl

# shellcheck source=/dev/null
source "$ROOT/.agents/skills/opencode-qa/scripts/lib/common.sh"
set -euo pipefail

host_session_count() {
  local db="$1"
  if [[ ! -f "$db" ]]; then
    printf 'NO_HOST_DB'
    return 0
  fi
  python3 - "$db" <<'PY'
import sqlite3, sys
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
try:
    print(con.execute("SELECT count(*) FROM session").fetchone()[0])
except Exception as exc:
    print(f"ERR:{exc}")
    sys.exit(1)
finally:
    con.close()
PY
}

FAKE_PID=""
SSE_PID=""
driver_cleanup() {
  [[ -n "${SSE_PID:-}" ]] && kill "$SSE_PID" 2>/dev/null || true
  [[ -n "${FAKE_PID:-}" ]] && kill "$FAKE_PID" 2>/dev/null || true
  if declare -F oqa_cleanup >/dev/null 2>&1; then oqa_cleanup || true; fi
}
trap driver_cleanup EXIT

HOST_DB="${HOME}/.local/share/opencode/opencode.db"
HOST_BEFORE="$(host_session_count "$HOST_DB")"
{
  echo "host_db=$HOST_DB"
  echo "host_session_count_before=$HOST_BEFORE"
} | tee "$EVID/isolation.txt"

oqa_mk_isolated_xdg
trap driver_cleanup EXIT
set -euo pipefail

# --- git project under isolated OQA_PROJ ---
PROJ="$OQA_PROJ"
cd "$PROJ"
git init -q
git config user.email "qa@example.com"
git config user.name "Final Wave QA"
printf '# Final-wave gate QA fixture\n' >README.md
printf '# Isolated OpenCode QA fixture\n' >AGENTS.md
mkdir -p .omo/plans

# Marked plan (enforced when git baseline exists)
cat >.omo/plans/marked-wave.md <<'PLAN'
# Final-wave marked plan

## TODOs
- [x] 1. Ship implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->
- [ ] F2. Code quality review <!-- role:code-reviewer -->
- [ ] F3. Real manual QA <!-- role:qa-executor -->
- [ ] F4. Scope fidelity check <!-- role:scope-auditor -->
PLAN

# Legacy unmarked plan (advisory / old behavior)
cat >.omo/plans/legacy-wave.md <<'PLAN'
# Final-wave legacy unmarked plan

## TODOs
- [x] 1. Ship implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity check
PLAN

git add README.md AGENTS.md .omo/plans/marked-wave.md .omo/plans/legacy-wave.md
git commit -q -m "init final-wave qa fixture"

write_boulder() {
  local plan_rel="$1"
  local plan_name="$2"
  local parent_session_id="${3:-}"
  local session_ids_json="[]"
  if [[ -n "$parent_session_id" ]]; then
    session_ids_json=$(printf '["%s"]' "$parent_session_id")
  fi
  cat >.omo/boulder.json <<JSON
{
  "active_plan": "${PROJ}/${plan_rel}",
  "started_at": "2026-07-20T00:00:00.000Z",
  "session_ids": ${session_ids_json},
  "session_origins": $(if [[ -n "$parent_session_id" ]]; then printf '{"%s":"direct"}' "$parent_session_id"; else printf '{}'; fi),
  "plan_name": "${plan_name}",
  "agent": "atlas"
}
JSON
}

create_parent_session() {
  local title="$1"
  local body
  body="$(curl -fsS --max-time 20 -u "opencode:$PASS" -H 'content-type: application/json' \
    -d "$(jq -nc --arg t "$title" '{title:$t}')" \
    "http://127.0.0.1:$PORT/session?directory=$ENCODED_PROJECT")"
  printf '%s' "$body" | jq -r '.id // empty'
}

# --- fake OpenAI Responses server ---
FS="$EVID/fake-server"
mkdir -p "$FS"
cp "$ROOT/.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs" "$FS/fake-openai-events.mjs"

cat >"$FS/fake-openai-server.mjs" <<'EOF'
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
    return sendSse(res, textEvents(callCount, "final-wave-qa"))
  }

  // Child reviewer sessions: prompt contains the F2 task echo from parent task()
  if (
    inputStr.includes("F2. Code quality review") &&
    !inputStr.includes("MARKED_REJECT_PROBE") &&
    !inputStr.includes("MARKED_RECEIPT_PROBE") &&
    !inputStr.includes("LEGACY_UNMARKED_PROBE") &&
    !hasResult
  ) {
    logTool({ branch: "child-reviewer", call: callCount })
    return sendSse(
      res,
      textEvents(
        callCount,
        "Reviewed the implementation against the plan scope.\nVERDICT: APPROVE\n",
      ),
    )
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

  if (inputStr.includes("MARKED_RECEIPT_PROBE") && !hasResult) {
    const args = {
      description: "F2 oracle review",
      prompt: f2Prompt(),
      subagent_type: "oracle",
      load_skills: [],
      run_in_background: false,
    }
    logTool({ branch: "marked-receipt", call: callCount, args })
    return sendSse(res, toolCallEvents(callCount, "task", `call_receipt_${callCount}`, args))
  }

  if (inputStr.includes("LEGACY_UNMARKED_PROBE") && !hasResult) {
    const args = {
      description: "F2 legacy category route",
      prompt: f2Prompt(),
      category: "unspecified-high",
      load_skills: [],
      run_in_background: false,
    }
    logTool({ branch: "legacy", call: callCount, args })
    return sendSse(res, toolCallEvents(callCount, "task", `call_legacy_${callCount}`, args))
  }

  if (hasResult) {
    if (inputStr.includes("MARKED_REJECT_PROBE")) {
      return sendSse(res, textEvents(callCount, "MARKED_REJECT_DONE"))
    }
    if (inputStr.includes("MARKED_RECEIPT_PROBE")) {
      return sendSse(res, textEvents(callCount, "MARKED_RECEIPT_DONE"))
    }
    if (inputStr.includes("LEGACY_UNMARKED_PROBE")) {
      return sendSse(res, textEvents(callCount, "LEGACY_DONE"))
    }
    return sendSse(res, textEvents(callCount, "PROBE_DONE"))
  }

  return sendSse(res, textEvents(callCount, `fake response ${callCount}`))
})

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port
  process.stdout.write(`fake-openai listening on ${port}\n`)
})
EOF

export FAKE_TOOL_CALL_LOG="$EVID/fake-tool-calls.jsonl"
: >"$FAKE_TOOL_CALL_LOG"
bun "$FS/fake-openai-server.mjs" >"$EVID/fake-server.log" 2>&1 &
FAKE_PID=$!
FAKE_PORT=""
for _ in $(seq 1 50); do
  FAKE_PORT=$(sed -n 's/.*listening on \([0-9][0-9]*\).*/\1/p' "$EVID/fake-server.log" | tail -1 || true)
  [[ -n "$FAKE_PORT" ]] && break
  sleep 0.1
done
[[ -n "$FAKE_PORT" ]] || { echo "FAIL: no FAKE_PORT" | tee "$EVID/qa-failure.txt"; exit 1; }
curl -sf "http://127.0.0.1:${FAKE_PORT}/health" >/dev/null

# --- OpenCode config pointing at local built plugin ---
CFG="${XDG_CONFIG_HOME}/opencode"
mkdir -p "$CFG"
cat >"$CFG/opencode.jsonc" <<EOF
{
  "plugin": ["file://${ROOT}"],
  "model": "openai/gpt-fake",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "qa-nonsecret",
        "baseURL": "http://127.0.0.1:${FAKE_PORT}/v1",
        "timeout": 60000
      },
      "models": {
        "gpt-fake": { "tool_call": true, "limit": { "context": 200000, "output": 8192 } }
      }
    }
  }
}
EOF
cat >"$CFG/oh-my-openagent.json" <<'EOF'
{
  "agents": {
    "atlas": { "model": "openai/gpt-fake" },
    "oracle": { "model": "openai/gpt-fake" },
    "momus": { "model": "openai/gpt-fake" },
    "qa-executor": { "model": "openai/gpt-fake" },
    "sisyphus-junior": { "model": "openai/gpt-fake" }
  },
  "categories": {
    "unspecified-high": { "model": "openai/gpt-fake" }
  }
}
EOF

# Start isolated server (reuse sandbox XDG; do not call oqa_start_server which makes a second sandbox)
PORT="$(oqa_free_port)"
PASS="qa-final-wave-pass"
OPENCODE_SERVER_PASSWORD="$PASS" opencode serve --port "$PORT" --hostname 127.0.0.1 \
  >"$XDG_STATE_HOME/opencode-serve.log" 2>&1 &
OQA_SERVER_PID=$!
export OQA_SERVER_PID
# Plugin load can accept TCP before /global/health responds; use short curl
# timeouts so the poll loop cannot hang forever (oqa_wait_http has no --max-time).
HEALTHY=0
for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 -u "opencode:$PASS" "http://127.0.0.1:$PORT/global/health" \
    >"$EVID/server-health.json" 2>/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 0.5
done
if [[ "$HEALTHY" -ne 1 ]]; then
  cp "$XDG_STATE_HOME/opencode-serve.log" "$EVID/opencode-serve.log" 2>/dev/null || true
  echo "FAIL: isolated OpenCode server did not become healthy" | tee "$EVID/qa-failure.txt"
  exit 1
fi

ENCODED_PROJECT="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PROJ")"
AGENTS=""
for _ in $(seq 1 120); do
  AGENTS="$(curl -fsS --max-time 3 -u "opencode:$PASS" "http://127.0.0.1:$PORT/agent?directory=$ENCODED_PROJECT" 2>/dev/null || true)"
  if printf '%s' "$AGENTS" | grep -qi 'atlas'; then break; fi
  sleep 0.5
done
printf '%s\n' "$AGENTS" | jq . >"$EVID/agent-list.json" 2>/dev/null || printf '%s\n' "$AGENTS" >"$EVID/agent-list.json"
ATLAS_AGENT="$(printf '%s' "$AGENTS" | jq -r '[.[] | select(((.name // "") | ascii_downcase | contains("atlas")) or ((.description // "") | ascii_downcase | contains("atlas")))][0].name // empty' 2>/dev/null || true)"
if [[ -z "$ATLAS_AGENT" ]]; then
  # fallback common names
  if printf '%s' "$AGENTS" | grep -q 'Atlas - Plan Executor'; then
    ATLAS_AGENT="Atlas - Plan Executor"
  elif printf '%s' "$AGENTS" | grep -qi '"atlas"'; then
    ATLAS_AGENT="atlas"
  else
    echo "FAIL: atlas agent not registered" | tee "$EVID/qa-failure.txt"
    cp "$XDG_STATE_HOME/opencode-serve.log" "$EVID/opencode-serve.log" 2>/dev/null || true
    exit 1
  fi
fi
echo "atlas_agent=$ATLAS_AGENT" >>"$EVID/isolation.txt"

run_probe() {
  local probe_tag="$1"
  local out_jsonl="$2"
  local out_sse="$3"
  local prompt="$4"
  local session_id="${5:-}"

  : >"$out_sse"
  curl -sN --max-time 180 -u "opencode:$PASS" \
    "http://127.0.0.1:$PORT/event?directory=$ENCODED_PROJECT" >"$out_sse" &
  SSE_PID=$!
  sleep 0.4

  set +e
  # Bound the live run so a stuck model/tool path cannot hang the whole QA.
  local -a run_args=(
    run
    --attach "http://127.0.0.1:$PORT"
    --password "$PASS"
    --dir "$PROJ"
    --model "openai/gpt-fake"
    --agent "$ATLAS_AGENT"
    --format json
  )
  if [[ -n "$session_id" ]]; then
    run_args+=(--session "$session_id")
  fi
  run_args+=("$prompt")
  timeout 120 opencode "${run_args[@]}" >"$out_jsonl" 2>"${out_jsonl}.stderr"
  local status=$?
  set -e

  # allow SSE to flush
  sleep 1.5
  kill "$SSE_PID" 2>/dev/null || true
  wait "$SSE_PID" 2>/dev/null || true
  SSE_PID=""
  return "$status"
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if ! rg -q "$pattern" "$file"; then
    echo "FAIL: $label — pattern not found: $pattern" | tee "$EVID/qa-failure.txt"
    echo "--- file: $file (first 80 lines) ---" >>"$EVID/qa-failure.txt"
    head -80 "$file" >>"$EVID/qa-failure.txt" 2>/dev/null || true
    exit 1
  fi
  echo "OK: $label"
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if rg -q "$pattern" "$file"; then
    echo "FAIL: $label — unexpected pattern: $pattern" | tee "$EVID/qa-failure.txt"
    exit 1
  fi
  echo "OK: $label"
}

# ========== (1) MARKED + category route → hard reject ==========
PARENT_REJECT="$(create_parent_session "fw-reject")"
[[ -n "$PARENT_REJECT" ]] || { echo "FAIL: could not create reject parent session" | tee "$EVID/qa-failure.txt"; exit 1; }
echo "parent_reject=$PARENT_REJECT" >>"$EVID/isolation.txt"
write_boulder ".omo/plans/marked-wave.md" "marked-wave" "$PARENT_REJECT"
rm -f .omo/plans/marked-wave.receipts.json
run_probe "reject" "$EVID/reject-run.jsonl" "$EVID/reject-sse.jsonl" \
  "MARKED_REJECT_PROBE: launch the final-wave F2 reviewer exactly once via task() then stop." \
  "$PARENT_REJECT"

# Capture rejection message artifact
{
  rg -n "final-wave-named-reviewer-rejection|REJECTED: Final-wave row F2|Categories never satisfy" \
    "$EVID/reject-run.jsonl" "$EVID/reject-sse.jsonl" "$EVID/reject-run.jsonl.stderr" 2>/dev/null || true
} >"$EVID/reject-message.txt" || true

# Prefer structured jsonl; fall back to SSE / stderr
REJECT_HIT=0
for f in "$EVID/reject-run.jsonl" "$EVID/reject-sse.jsonl" "$EVID/reject-run.jsonl.stderr"; do
  if [[ -f "$f" ]] && rg -q "final-wave-named-reviewer-rejection|REJECTED: Final-wave row F2" "$f"; then
    REJECT_HIT=1
    break
  fi
done
if [[ "$REJECT_HIT" -ne 1 ]]; then
  echo "FAIL: marked category F launch was not rejected" | tee "$EVID/qa-failure.txt"
  head -100 "$EVID/reject-run.jsonl" >>"$EVID/qa-failure.txt" 2>/dev/null || true
  head -100 "$EVID/reject-sse.jsonl" >>"$EVID/qa-failure.txt" 2>/dev/null || true
  head -50 "$EVID/reject-run.jsonl.stderr" >>"$EVID/qa-failure.txt" 2>/dev/null || true
  cp "$XDG_STATE_HOME/opencode-serve.log" "$EVID/opencode-serve.log" 2>/dev/null || true
  exit 1
fi
echo "OK: (1) marked category F launch rejected"

# SSE must show tool lifecycle activity around the rejection
if ! rg -q "message\.part\.updated|tool|task" "$EVID/reject-sse.jsonl"; then
  echo "FAIL: reject SSE stream missing tool/message activity" | tee "$EVID/qa-failure.txt"
  exit 1
fi
echo "OK: (1) SSE captured tool/message activity for rejection"

# No expectation/receipt for rejected launch
if [[ -f .omo/plans/marked-wave.receipts.json ]]; then
  if rg -q '"F2"' .omo/plans/marked-wave.receipts.json && rg -q '"expectations"' .omo/plans/marked-wave.receipts.json; then
    # F2 expectation must be absent
    if python3 - <<'PY'
import json
from pathlib import Path
p = Path(".omo/plans/marked-wave.receipts.json")
data = json.loads(p.read_text())
exp = data.get("expectations") or {}
if "F2" in exp or "f2" in exp:
    raise SystemExit(1)
raise SystemExit(0)
PY
    then
      echo "OK: (1) no F2 expectation after rejection"
    else
      echo "FAIL: F2 expectation persisted after rejection" | tee "$EVID/qa-failure.txt"
      exit 1
    fi
  fi
fi

# ========== (2) MARKED + correct oracle route → receipt ==========
PARENT_RECEIPT="$(create_parent_session "fw-receipt")"
[[ -n "$PARENT_RECEIPT" ]] || { echo "FAIL: could not create receipt parent session" | tee "$EVID/qa-failure.txt"; exit 1; }
echo "parent_receipt=$PARENT_RECEIPT" >>"$EVID/isolation.txt"
write_boulder ".omo/plans/marked-wave.md" "marked-wave" "$PARENT_RECEIPT"
rm -f .omo/plans/marked-wave.receipts.json
run_probe "receipt" "$EVID/receipt-run.jsonl" "$EVID/receipt-sse.jsonl" \
  "MARKED_RECEIPT_PROBE: launch the final-wave F2 reviewer exactly once via task() with the bound named subagent then stop." \
  "$PARENT_RECEIPT"

RECEIPT_PATH=".omo/plans/marked-wave.receipts.json"
if [[ ! -f "$RECEIPT_PATH" ]]; then
  echo "FAIL: receipt sidecar missing after correct F2 launch" | tee "$EVID/qa-failure.txt"
  head -100 "$EVID/receipt-run.jsonl" >>"$EVID/qa-failure.txt" 2>/dev/null || true
  head -100 "$EVID/receipt-sse.jsonl" >>"$EVID/qa-failure.txt" 2>/dev/null || true
  head -50 "$EVID/receipt-run.jsonl.stderr" >>"$EVID/qa-failure.txt" 2>/dev/null || true
  cp "$XDG_STATE_HOME/opencode-serve.log" "$EVID/opencode-serve.log" 2>/dev/null || true
  ls -la .omo/plans/ >>"$EVID/qa-failure.txt" 2>/dev/null || true
  exit 1
fi
cp "$RECEIPT_PATH" "$EVID/receipt-sidecar.json"

python3 - <<'PY' || { echo "FAIL: receipt assertions" | tee "$EVID/qa-failure.txt"; exit 1; }
import json
from pathlib import Path
data = json.loads(Path(".omo/plans/marked-wave.receipts.json").read_text())
receipts = data.get("receipts") or {}
# keys may be F2
rec = receipts.get("F2") or receipts.get("f2")
if not rec:
    # also accept any single receipt for code-reviewer/oracle
    for k, v in receipts.items():
        if str(v.get("actualAgent","")).lower() == "oracle" or str(v.get("role","")).find("code-reviewer") >= 0:
            rec = v
            break
if not rec:
    raise SystemExit(f"no F2 receipt in {receipts!r}")
if str(rec.get("verdict","")).lower() != "approve":
    raise SystemExit(f"verdict not approve: {rec!r}")
agent = str(rec.get("actualAgent") or "")
if agent != "oracle":
    raise SystemExit(f"actualAgent not oracle: {agent!r}")
if not rec.get("launchId"):
    raise SystemExit("missing launchId")
if not rec.get("childSessionId"):
    raise SystemExit("missing childSessionId")
print("OK receipt F2 approve oracle")
PY
echo "OK: (2) durable F2 receipt written"

# ========== (3) LEGACY unmarked → no rejection ==========
PARENT_LEGACY="$(create_parent_session "fw-legacy")"
[[ -n "$PARENT_LEGACY" ]] || { echo "FAIL: could not create legacy parent session" | tee "$EVID/qa-failure.txt"; exit 1; }
echo "parent_legacy=$PARENT_LEGACY" >>"$EVID/isolation.txt"
write_boulder ".omo/plans/legacy-wave.md" "legacy-wave" "$PARENT_LEGACY"
rm -f .omo/plans/legacy-wave.receipts.json
run_probe "legacy" "$EVID/legacy-run.jsonl" "$EVID/legacy-sse.jsonl" \
  "LEGACY_UNMARKED_PROBE: launch the final-wave F2 reviewer exactly once via task() then stop." \
  "$PARENT_LEGACY"

LEGACY_BLOB="$EVID/legacy-combined.txt"
cat "$EVID/legacy-run.jsonl" "$EVID/legacy-sse.jsonl" "$EVID/legacy-run.jsonl.stderr" 2>/dev/null >"$LEGACY_BLOB" || true
if rg -q "final-wave-named-reviewer-rejection|REJECTED: Final-wave row" "$LEGACY_BLOB"; then
  echo "FAIL: legacy-unmarked plan was rejected (must keep old behavior)" | tee "$EVID/qa-failure.txt"
  exit 1
fi
# Should have attempted a task tool call (category route allowed)
if ! rg -q '"task"|tool.*task|call_legacy' "$LEGACY_BLOB" "$EVID/fake-tool-calls.jsonl"; then
  echo "FAIL: legacy probe did not issue task tool call" | tee "$EVID/qa-failure.txt"
  exit 1
fi
# No receipt requirement / no enforced sidecar for legacy
if [[ -f .omo/plans/legacy-wave.receipts.json ]]; then
  # expectations may exist in advisory mode for marked only; legacy should not write F-wave expectations
  python3 - <<'PY' || { echo "FAIL: legacy wrote enforced-style receipts" | tee "$EVID/qa-failure.txt"; exit 1; }
import json
from pathlib import Path
p = Path(".omo/plans/legacy-wave.receipts.json")
if not p.exists():
    raise SystemExit(0)
data = json.loads(p.read_text())
if data.get("receipts"):
    raise SystemExit("legacy should not have approval receipts")
print("legacy sidecar has no receipts (ok)")
PY
fi
{
  echo "legacy_rejection=none"
  echo "legacy_task_attempted=yes"
  echo "legacy_behavior=unchanged_advisory_passthrough"
} | tee "$EVID/legacy-no-rejection.txt"
echo "OK: (3) legacy-unmarked plan not rejected"

# ========== (4) isolation proof ==========
cp "$XDG_STATE_HOME/opencode-serve.log" "$EVID/opencode-serve.log" 2>/dev/null || true
HOST_AFTER="$(host_session_count "$HOST_DB")"
{
  echo "host_session_count_after=$HOST_AFTER"
  if [[ "$HOST_BEFORE" == "$HOST_AFTER" ]]; then
    echo "host_session_count_diff=0"
    echo "unchanged=yes"
  else
    echo "host_session_count_diff=$((HOST_AFTER - HOST_BEFORE))"
    echo "unchanged=no"
  fi
  echo "sandbox_session_db=${XDG_DATA_HOME}/opencode/opencode.db"
  if [[ -f "${XDG_DATA_HOME}/opencode/opencode.db" ]]; then
    echo "sandbox_session_count=$(host_session_count "${XDG_DATA_HOME}/opencode/opencode.db")"
  fi
  echo "sandbox_proj=$PROJ"
} | tee -a "$EVID/isolation.txt"

if ! rg -q '^unchanged=yes$' "$EVID/isolation.txt"; then
  echo "FAIL: host session count changed" | tee "$EVID/qa-failure.txt"
  exit 1
fi
echo "OK: (4) host DB session count unchanged"

printf 'QA_PASS marked_reject=yes marked_receipt=yes legacy_no_reject=yes isolation_diff=0 atlas=%s\n' \
  "$ATLAS_AGENT" | tee "$EVID/qa-pass.txt"
