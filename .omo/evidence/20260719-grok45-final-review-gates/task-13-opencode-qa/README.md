# Task 13 — OpenCode real-harness QA (final-wave reviewer gates)

Plan: `grok45-final-review-gates` on `feat/grok-4.5-basic-support`.
Surface: OpenCode 1.18.3 HTTP server + `opencode run --attach --format json` with the local built plugin (`file://$REPO`), isolated XDG sandbox, local fake OpenAI Responses server (no real provider calls).

Driver: [`run-isolated-qa.sh`](./run-isolated-qa.sh)

## WHAT WAS TESTED

1. **Marked plan + category-routed F-row launch is rejected at `tool.execute.before`**
   - Fixture: git workspace + marked F1–F4 plan (role markers) + boulder parent session.
   - Fake model issued `task(category="unspecified-high", prompt with F2 echo)`.
   - Captured structured tool error + SSE `message.part.updated` with the rejection body.

2. **Correctly-routed F-row completion writes a durable receipt**
   - Same marked plan; fake model issued `task(subagent_type="oracle", F2 echo, sync)`.
   - Child oracle session returned line-anchored `VERDICT: APPROVE`.
   - Asserted `.omo/plans/marked-wave.receipts.json` contains F2 receipt with matching `launchId`, `childSessionId`, `actualAgent=oracle`, `verdict=approve`.

3. **Legacy-unmarked plan keeps old behavior**
   - Unmarked F-wave plan; same category-routed F2 `task()` launch.
   - Asserted no `final-wave-named-reviewer-rejection` and task attempt proceeded.

4. **Host DB isolation**
   - `SELECT count(*) FROM session` on real `~/.local/share/opencode/opencode.db` before vs after.
   - Required diff = 0.

## WHAT WAS OBSERVED

| Assertion | Result | Artifact |
|---|---|---|
| (1) Marked category F2 rejected | PASS | [`reject-run.jsonl`](./reject-run.jsonl), [`reject-sse.jsonl`](./reject-sse.jsonl), [`reject-message.txt`](./reject-message.txt) |
| (1) SSE tool/message activity | PASS | `message.part.updated` with `tool=task`, `status=error`, rejection body |
| (2) Durable F2 receipt | PASS | [`receipt-sidecar.json`](./receipt-sidecar.json), [`receipt-run.jsonl`](./receipt-run.jsonl), [`receipt-sse.jsonl`](./receipt-sse.jsonl) |
| (3) Legacy no rejection | PASS | [`legacy-no-rejection.txt`](./legacy-no-rejection.txt), [`legacy-run.jsonl`](./legacy-run.jsonl), [`legacy-sse.jsonl`](./legacy-sse.jsonl) |
| (4) Host session count unchanged | PASS | [`isolation.txt`](./isolation.txt) — before=97, after=97, diff=0 |

Key rejection excerpt (from SSE + jsonl):

```text
<final-wave-named-reviewer-rejection>
REJECTED: Final-wave row F2 requires named reviewer subagent_type="oracle" (role:code-reviewer).
Requested route was category="unspecified-high". Categories never satisfy final-wave rows.
This task() launch was blocked. No launch expectation was recorded. Relaunch with the bound subagent.
</final-wave-named-reviewer-rejection>
```

Key receipt excerpt ([`receipt-sidecar.json`](./receipt-sidecar.json)):

```json
"receipts": {
  "F2": {
    "role": "code-reviewer",
    "expectedSubagent": "oracle",
    "actualAgent": "oracle",
    "verdict": "approve",
    "launchId": "8169fe32-cd16-49aa-be7b-71387d2bd2b2",
    "childSessionId": "ses_0824d6022ffehKH0hg48QGdHfH"
  }
}
```

Isolation ([`isolation.txt`](./isolation.txt)):

```text
host_session_count_before=97
host_session_count_after=97
host_session_count_diff=0
unchanged=yes
sandbox_session_count=5
```

Overall gate: [`qa-pass.txt`](./qa-pass.txt)

```text
QA_PASS marked_reject=yes marked_receipt=yes legacy_no_reject=yes isolation_diff=0 atlas=Atlas - Plan Executor
```

## WHY IT IS ENOUGH

- Drives the **real** OpenCode harness (serve + run + SSE), not unit tests alone.
- Rejection is proven on the wire: tool part `status=error` with the exact named-reviewer rejection tag, which is the `tool.execute.before` hard-reject path under enforced mode (marked plan + git baseline).
- Receipt path proves the full before→spawn→after chain: expectation stamped, binding written, identity-matched APPROVE receipt durable on disk.
- Legacy polarity proves fail-closed does not brick unmarked plans.
- Host DB count proof satisfies the repo isolation mandate.

## WHAT WAS OMITTED

- Real provider API calls (local fake OpenAI Responses server only; synthetic `qa-nonsecret` key).
- Raw auth headers, env dumps, and full model request bodies.
- Host plugin refresh (`omo-local-plugin.sh refresh`) — owned by Todo 15.
- Codex-side QA — owned by Todo 14.
- Full F1–F4 multi-reviewer wave (Todo 13 requires one correctly-routed F-row receipt; F2/oracle is the representative path).
- `sqlite3` CLI was unavailable on this host; session counts used Python's stdlib `sqlite3` against the same DB path.

## HOW TO REPRODUCE

```bash
# from repo root; requires opencode, bun, curl, jq, python3
bash .omo/evidence/20260719-grok45-final-review-gates/task-13-opencode-qa/run-isolated-qa.sh
# expect qa-pass.txt and unchanged=yes in isolation.txt
```

`dist/` was verified current (final-wave enforcement markers present; source mtimes older than `dist/index.js`). No rebuild in this task.
