#!/usr/bin/env bash
# Isolated OpenCode real-harness QA for Todo 15 no-regression:
# (1) NON-F category task → metadata.agent=sisyphus-junior + model grok-4.5 chain
# (2) Marked F-row category route → hard reject (polarity contrast)
# (3) host opencode.db session count unchanged
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EVID="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$EVID"
rm -f "$EVID"/{isolation.txt,qa-pass.txt,qa-failure.txt,server-health.json,agent-list.json}
rm -f "$EVID"/{nonf-run.jsonl,reject-run.jsonl,nonf-sse.jsonl,reject-sse.jsonl}
rm -f "$EVID"/{nonf-metadata.json,reject-message.txt,fake-server.log,opencode-serve.log}
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
  echo "opencode_version=$(opencode --version 2>/dev/null || echo unknown)"
} | tee "$EVID/isolation.txt"

oqa_mk_isolated_xdg
trap driver_cleanup EXIT
set -euo pipefail

PROJ="$OQA_PROJ"
cd "$PROJ"
git init -q
git config user.email "qa@example.com"
git config user.name "Todo15 No-Regression QA"
printf '# Todo15 no-regression QA fixture\n' >README.md
printf '# Isolated OpenCode QA fixture\n' >AGENTS.md
mkdir -p .omo/plans

cat >.omo/plans/marked-wave.md <<'PLAN'
# Final-wave marked plan (polarity contrast only)

## TODOs
- [x] 1. Ship implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. Plan compliance audit <!-- role:plan-auditor -->
- [ ] F2. Code quality review <!-- role:code-reviewer -->
- [ ] F3. Real manual QA <!-- role:qa-executor -->
- [ ] F4. Scope fidelity check <!-- role:scope-auditor -->
PLAN

# Implementation-only plan (no F-wave) for ordinary category delegation
cat >.omo/plans/impl-only.md <<'PLAN'
# Implementation-only plan (no final wave)

## TODOs
- [ ] 1. Ordinary category implementation task
PLAN

git add README.md AGENTS.md .omo/plans/marked-wave.md .omo/plans/impl-only.md
git commit -q -m "init todo15 no-regression qa fixture"

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

# Grok-pinned config: sisyphus-junior + unspecified-high → xai/grok-4.5
# Fake xai provider serves the same local Responses server so no real API call.
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
    },
    "xai": {
      "options": {
        "apiKey": "qa-nonsecret",
        "baseURL": "http://127.0.0.1:${FAKE_PORT}/v1",
        "timeout": 60000
      },
      "models": {
        "grok-4.5": {
          "name": "Grok 4.5 (QA fake)",
          "tool_call": true,
          "limit": { "context": 200000, "output": 8192 }
        }
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
    "sisyphus-junior": {
      "model": "xai/grok-4.5",
      "variant": "medium"
    }
  },
  "categories": {
    "unspecified-high": {
      "model": "xai/grok-4.5",
      "variant": "high"
    }
  }
}
EOF

# Synthetic provider auth only (no real secrets). Required so OpenCode marks
# openai + xai as connected and availableModels includes xai/grok-4.5.
mkdir -p "${XDG_DATA_HOME}/opencode"
cat >"${XDG_DATA_HOME}/opencode/auth.json" <<'EOF'
{
  "openai": { "type": "api", "key": "qa-nonsecret" },
  "xai": { "type": "api", "key": "qa-nonsecret" }
}
EOF

PORT="$(oqa_free_port)"
PASS="qa-todo15-pass"
OPENCODE_SERVER_PASSWORD="$PASS" opencode serve --port "$PORT" --hostname 127.0.0.1 \
  >"$XDG_STATE_HOME/opencode-serve.log" 2>&1 &
OQA_SERVER_PID=$!
export OQA_SERVER_PID
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

# Capture sisyphus-junior model from agent list if present
python3 - "$EVID/agent-list.json" >>"$EVID/isolation.txt" <<'PY' || true
import json, sys
from pathlib import Path
raw = Path(sys.argv[1]).read_text()
try:
    agents = json.loads(raw)
except Exception:
    print("sisyphus_junior_agent_list=unparsed")
    raise SystemExit(0)
if not isinstance(agents, list):
    print("sisyphus_junior_agent_list=not-list")
    raise SystemExit(0)
for a in agents:
    name = str(a.get("name") or "")
    if "sisyphus-junior" in name.lower() or name.lower() == "sisyphus-junior":
        model = a.get("model") or a.get("mode") or {}
        print(f"sisyphus_junior_name={name}")
        print(f"sisyphus_junior_model_field={json.dumps(model, sort_keys=True)}")
        break
else:
    print("sisyphus_junior_agent_list=missing")
PY

run_probe() {
  local out_jsonl="$1"
  local out_sse="$2"
  local prompt="$3"
  local session_id="${4:-}"

  : >"$out_sse"
  curl -sN --max-time 180 -u "opencode:$PASS" \
    "http://127.0.0.1:$PORT/event?directory=$ENCODED_PROJECT" >"$out_sse" &
  SSE_PID=$!
  sleep 0.4

  set +e
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

  sleep 1.5
  kill "$SSE_PID" 2>/dev/null || true
  wait "$SSE_PID" 2>/dev/null || true
  SSE_PID=""
  return "$status"
}

# ========== (1) NON-F category → sisyphus-junior + grok-4.5 ==========
PARENT_NONF="$(create_parent_session "todo15-nonf")"
[[ -n "$PARENT_NONF" ]] || { echo "FAIL: could not create nonf parent session" | tee "$EVID/qa-failure.txt"; exit 1; }
echo "parent_nonf=$PARENT_NONF" >>"$EVID/isolation.txt"
write_boulder ".omo/plans/impl-only.md" "impl-only" "$PARENT_NONF"
run_probe "$EVID/nonf-run.jsonl" "$EVID/nonf-sse.jsonl" \
  "NONF_CATEGORY_PROBE: launch exactly one ordinary implementation task via task(category=unspecified-high) then stop." \
  "$PARENT_NONF"

set +e
python3 - "$EVID/nonf-run.jsonl" "$EVID/nonf-sse.jsonl" "$EVID/nonf-metadata.json" <<'PY'
import json, re, sys
from pathlib import Path

paths = [Path(sys.argv[1]), Path(sys.argv[2])]
out_path = Path(sys.argv[3])
blobs = []
for p in paths:
    if p.exists():
        blobs.append(p.read_text(errors="replace"))
text = "\n".join(blobs)

# Prefer structured tool_use metadata.agent
agent = None
model_obj = None
category = None
for line in text.splitlines():
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        obj = json.loads(line)
    except Exception:
        continue
    part = obj.get("part") or obj
    state = (part.get("state") if isinstance(part, dict) else None) or {}
    meta = state.get("metadata") if isinstance(state, dict) else None
    if not isinstance(meta, dict):
        # SSE shape sometimes nests differently
        meta = part.get("metadata") if isinstance(part, dict) else None
    if not isinstance(meta, dict):
        continue
    if meta.get("agent") or meta.get("category"):
        agent = meta.get("agent") or agent
        category = meta.get("category") or category
        model_obj = meta.get("model") or model_obj
        if agent == "sisyphus-junior":
            break

# Fallback: plain text "Agent: sisyphus-junior" / "Model: xai/grok-4.5"
if not agent:
    m = re.search(r"Agent:\s*([^\s\n]+)", text)
    if m:
        agent = m.group(1).strip()
if model_obj is None:
    m = re.search(r"Model:\s*([^\s\n]+)", text)
    if m:
        model_obj = m.group(1).strip()

model_str = ""
if isinstance(model_obj, dict):
    pid = model_obj.get("providerID") or model_obj.get("provider") or ""
    mid = model_obj.get("modelID") or model_obj.get("model") or ""
    if pid and mid:
        model_str = f"{pid}/{mid}"
    else:
        model_str = json.dumps(model_obj, sort_keys=True)
elif isinstance(model_obj, str):
    model_str = model_obj

agent_norm = (agent or "").strip().lower().replace("_", "-")
result = {
    "agent": agent,
    "agent_normalized": agent_norm,
    "category": category,
    "model": model_obj,
    "model_str": model_str,
    "agent_ok": agent_norm == "sisyphus-junior",
    "model_ok": bool(re.search(r"grok-4\.5", model_str, re.I)) or (
        isinstance(model_obj, dict)
        and str(model_obj.get("providerID") or model_obj.get("provider") or "").lower() == "xai"
        and "grok" in str(model_obj.get("modelID") or model_obj.get("model") or "").lower()
    ),
}
out_path.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
if not result["agent_ok"]:
    raise SystemExit(f"agent not sisyphus-junior: {agent!r}")
if not result["model_ok"]:
    raise SystemExit(f"model not grok-4.5 chain: {model_str!r} raw={model_obj!r}")
print("OK non-F category → sisyphus-junior + grok-4.5")
PY
NONF_STATUS=$?
set -e
if [[ "$NONF_STATUS" -ne 0 ]]; then
  echo "FAIL: non-F category metadata assertions" | tee "$EVID/qa-failure.txt"
  head -80 "$EVID/nonf-run.jsonl" >>"$EVID/qa-failure.txt" 2>/dev/null || true
  head -40 "$EVID/nonf-run.jsonl.stderr" >>"$EVID/qa-failure.txt" 2>/dev/null || true
  exit 1
fi
echo "OK: (1) non-F category routes to sisyphus-junior + grok-4.5 chain"

# ========== (2) MARKED F-row category → hard reject (polarity) ==========
PARENT_REJECT="$(create_parent_session "todo15-reject")"
[[ -n "$PARENT_REJECT" ]] || { echo "FAIL: could not create reject parent session" | tee "$EVID/qa-failure.txt"; exit 1; }
echo "parent_reject=$PARENT_REJECT" >>"$EVID/isolation.txt"
write_boulder ".omo/plans/marked-wave.md" "marked-wave" "$PARENT_REJECT"
rm -f .omo/plans/marked-wave.receipts.json
run_probe "$EVID/reject-run.jsonl" "$EVID/reject-sse.jsonl" \
  "MARKED_REJECT_PROBE: launch the final-wave F2 reviewer exactly once via task() then stop." \
  "$PARENT_REJECT"

{
  rg -n "final-wave-named-reviewer-rejection|REJECTED: Final-wave row F2|Categories never satisfy" \
    "$EVID/reject-run.jsonl" "$EVID/reject-sse.jsonl" "$EVID/reject-run.jsonl.stderr" 2>/dev/null || true
} >"$EVID/reject-message.txt" || true

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
  exit 1
fi
echo "OK: (2) marked F-row category route rejected (polarity contrast)"

# ========== (3) isolation proof ==========
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
echo "OK: (3) host DB session count unchanged"

printf 'QA_PASS nonf_sisyphus_junior_grok=yes marked_f_category_reject=yes isolation_diff=0 atlas=%s\n' \
  "$ATLAS_AGENT" | tee "$EVID/qa-pass.txt"
