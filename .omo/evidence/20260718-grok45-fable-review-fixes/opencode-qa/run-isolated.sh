#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:?repository root required}"
EVIDENCE_DIR="${2:?evidence directory required}"
mkdir -p "$EVIDENCE_DIR"
rm -f "$EVIDENCE_DIR"/{agent-list.json,atlas-registration.json,isolation.txt,opencode-serve.log,qa-failure.txt,qa-pass.txt,run-atlas-grok-fallback.jsonl,runtime-fallback-low-effort.json,sanitized-model-requests.jsonl,server-health.json,sse-session-error-and-message-updated.jsonl,system-transform-atlas-grok.json}

# Source the reviewed opencode-qa lifecycle helpers before sandboxing HOME.
# shellcheck source=/dev/null
source "$ROOT/.agents/skills/opencode-qa/scripts/lib/common.sh"
set -euo pipefail

# The host count is captured before oqa_mk_isolated_xdg changes HOME and XDG.
HOST_DB="$(oqa_db_path)"
if [ -n "$HOST_DB" ] && [ -f "$HOST_DB" ]; then
  HOST_BEFORE="$(sqlite3 -readonly "$HOST_DB" 'SELECT count(*) FROM session')"
else
  HOST_BEFORE="missing"
fi

FAKE_PID=""
SSE_PID=""
cleanup() {
  [ -n "$SSE_PID" ] && kill "$SSE_PID" 2>/dev/null || true
  [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null || true
  oqa_cleanup || true
}
trap cleanup EXIT

oqa_mk_isolated_xdg
trap cleanup EXIT
printf '# Isolated OpenCode QA fixture\n' >"$OQA_PROJ/AGENTS.md"

bun "$EVIDENCE_DIR/fake-openai-capture.mjs" 0 "$EVIDENCE_DIR/sanitized-model-requests.jsonl" >"$XDG_STATE_HOME/fake-openai.log" 2>&1 &
FAKE_PID=$!
for _ in $(seq 1 50); do
  if grep -q '^PORT=' "$XDG_STATE_HOME/fake-openai.log"; then break; fi
  sleep 0.1
done
FAKE_PORT="$(awk -F= '/^PORT=/{print $2; exit}' "$XDG_STATE_HOME/fake-openai.log")"
test -n "$FAKE_PORT"
curl -fsS "http://127.0.0.1:$FAKE_PORT/health" >/dev/null

CFG="$XDG_CONFIG_HOME/opencode"
mkdir -p "$CFG"
cat >"$CFG/opencode.jsonc" <<JSONC
{
  "plugin": ["file://${ROOT}/dist/index.js"],
  "model": "openai/gpt-fallback",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "qa-nonsecret",
        "baseURL": "http://127.0.0.1:${FAKE_PORT}/v1",
        "timeout": 30000
      },
      "models": {
        "grok-4.5": { "tool_call": true, "limit": { "context": 200000, "output": 8192 } },
        "gpt-fallback": { "tool_call": true, "limit": { "context": 200000, "output": 8192 } }
      }
    }
  }
}
JSONC
cat >"$CFG/oh-my-openagent.json" <<'JSON'
{
  "runtime_fallback": { "enabled": true },
  "agents": {
    "atlas": {
      "model": "openai/gpt-fallback",
      "fallback_models": [
        { "model": "openai/gpt-fallback", "reasoningEffort": "low" }
      ]
    }
  }
}
JSON

# oqa_start_server creates a second sandbox, so it cannot consume the
# sandbox-local config above. Use its lower-level lifecycle helpers instead.
PORT="$(oqa_free_port)"
PASS="qa-isolated-pass"
OPENCODE_SERVER_PASSWORD="$PASS" opencode serve --port "$PORT" --hostname 127.0.0.1 >"$XDG_STATE_HOME/opencode-serve.log" 2>&1 &
OQA_SERVER_PID=$!
export OQA_SERVER_PID
if ! oqa_wait_http "http://127.0.0.1:$PORT/global/health" "opencode:$PASS" 30; then
  cp "$XDG_STATE_HOME/opencode-serve.log" "$EVIDENCE_DIR/opencode-serve.log" 2>/dev/null || true
  printf 'FAIL: isolated OpenCode server did not become healthy; see opencode-serve.log\n' >"$EVIDENCE_DIR/qa-failure.txt"
  exit 1
fi
curl -fsS -u "opencode:$PASS" "http://127.0.0.1:$PORT/global/health" >"$EVIDENCE_DIR/server-health.json"

ENCODED_PROJECT="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$OQA_PROJ")"
for _ in $(seq 1 150); do
  AGENTS="$(curl -fsS -u "opencode:$PASS" "http://127.0.0.1:$PORT/agent?directory=$ENCODED_PROJECT" 2>/dev/null || true)"
  if printf '%s' "$AGENTS" | grep -qi '"atlas"'; then break; fi
  sleep 0.2
done
printf '%s\n' "$AGENTS" | jq . >"$EVIDENCE_DIR/agent-list.json"
printf '%s\n' "$AGENTS" | jq '[.[] | select(((.name // "") | ascii_downcase | contains("atlas")) or ((.description // "") | ascii_downcase | contains("atlas"))) | { name, model, description }]' >"$EVIDENCE_DIR/atlas-registration.json"
grep -qi 'atlas' "$EVIDENCE_DIR/atlas-registration.json"
ATLAS_AGENT="$(jq -r '.[0].name // empty' "$EVIDENCE_DIR/atlas-registration.json")"
test -n "$ATLAS_AGENT"

curl -sN -u "opencode:$PASS" "http://127.0.0.1:$PORT/event?directory=$ENCODED_PROJECT" >"$EVIDENCE_DIR/sse-session-error-and-message-updated.jsonl" &
SSE_PID=$!
sleep 0.5

set +e
opencode run --attach "http://127.0.0.1:$PORT" --password "$PASS" --dir "$OQA_PROJ" --model "openai/grok-4.5" --agent "$ATLAS_AGENT" --format json "Reply exactly QA_FALLBACK_OK." >"$EVIDENCE_DIR/run-atlas-grok-fallback.jsonl" &
RUN_PID=$!
RUN_STATUS=0
for _ in $(seq 1 450); do
  kill -0 "$RUN_PID" 2>/dev/null || break
  sleep 0.2
done
if kill -0 "$RUN_PID" 2>/dev/null; then
  kill "$RUN_PID" 2>/dev/null || true
  RUN_STATUS=124
fi
wait "$RUN_PID" 2>/dev/null || RUN_STATUS=$?
set -e
for _ in $(seq 1 150); do
  grep -q 'QA_FALLBACK_OK' "$EVIDENCE_DIR/run-atlas-grok-fallback.jsonl" && break
  grep -q '"model":"gpt-fallback"' "$EVIDENCE_DIR/sanitized-model-requests.jsonl" && break
  sleep 0.2
done
sleep 2
kill "$SSE_PID" 2>/dev/null || true
SSE_PID=""
cp "$XDG_STATE_HOME/opencode-serve.log" "$EVIDENCE_DIR/opencode-serve.log"

if [ -n "$HOST_DB" ] && [ -f "$HOST_DB" ]; then
  HOST_AFTER="$(sqlite3 -readonly "$HOST_DB" 'SELECT count(*) FROM session')"
else
  HOST_AFTER="missing"
fi
printf 'host_session_count_before=%s\nhost_session_count_after=%s\nunchanged=%s\nsandbox_session_db=%s\n' \
  "$HOST_BEFORE" "$HOST_AFTER" "$([ "$HOST_BEFORE" = "$HOST_AFTER" ] && printf yes || printf no)" \
  "$XDG_DATA_HOME/opencode/opencode.db" >"$EVIDENCE_DIR/isolation.txt"

node - "$EVIDENCE_DIR/sanitized-model-requests.jsonl" "$EVIDENCE_DIR/system-transform-atlas-grok.json" "$EVIDENCE_DIR/runtime-fallback-low-effort.json" <<'NODE'
const fs = require("node:fs")
const [input, systemOutput, fallbackOutput] = process.argv.slice(2)
const requests = fs.readFileSync(input, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
const grok = requests.find((request) => request.model.includes("grok-4.5"))
const fallback = requests.find((request) => request.model.includes("gpt-fallback"))
if (!grok?.grokAtlasOverlay) throw new Error("Atlas Grok overlay was absent from the live model request")
if (!fallback) throw new Error("runtime fallback did not issue a fallback model request")
fs.writeFileSync(systemOutput, `${JSON.stringify({ hook: "experimental.chat.system.transform", runtimeModel: grok.model, grokAtlasOverlay: grok.grokAtlasOverlay }, null, 2)}\n`)
fs.writeFileSync(fallbackOutput, `${JSON.stringify({ eventPath: "session.status -> runtime fallback", fallbackModel: fallback.model, configuredReasoningEffort: "low", requestLowEffortObserved: fallback.lowEffort }, null, 2)}\n`)
NODE

grep -q 'message.updated' "$EVIDENCE_DIR/sse-session-error-and-message-updated.jsonl"
grep -q 'QA_FALLBACK_OK' "$EVIDENCE_DIR/sse-session-error-and-message-updated.jsonl"
grep -q '^unchanged=yes$' "$EVIDENCE_DIR/isolation.txt"
test "$RUN_STATUS" -eq 0
printf 'QA_PASS system_transform=experimental.chat.system.transform runtime_fallback=session.status+message.updated fallback_model=gpt-fallback\n' | tee "$EVIDENCE_DIR/qa-pass.txt"
