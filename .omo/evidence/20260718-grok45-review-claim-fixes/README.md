# Grok 4.5 Review Claim Fixes Verification

## What Was Tested

- Ran the required focused unit suites, model-chain suites, capability suites, repository typecheck, and repository build. Outputs are captured in `unit-bash.txt`, `unit-chains.txt`, `unit-capability.txt`, `typecheck.txt`, and `build.txt`.
- Ran `opencode-qa/run-prometheus-bash-qa.sh` against the real OpenCode 1.18.3 CLI in an isolated XDG/HOME sandbox with a local fake OpenAI Responses server.
- Drove the real Prometheus agent through three deterministic `opencode run --format json` branches: a malicious `node -e` deny probe, package-rooted scaffold allow probe, and D5 disabled-hook probe.
- Oracle F1/F3 reject fix: restored enabled-hook Prometheus `bash` to `PROMETHEUS_BASH_PERMISSION` (pattern map, not plain `"allow"`). Reordered map keys so catch-all `"*": "deny"` is first and `"*scaffold-plan.mjs*": "allow"` is last (OpenCode last-match-wins + `PermissionNext.disabled()` preflight).

## What Was Observed

- Focused bash-policy and tool-config tests passed: 145 tests, 0 failures (after F1/F3 restore). The model-chain suite passed: 22 tests, 0 failures. Capability suite passed: 100 tests, 0 failures.
- The deny branch emitted a structured `tool_use` for the exact malicious command, the `prometheus-md-only` error, and left the marker absent. Bash remained visible under the pattern map; the hook is SoT for realpath/`-e` rejection.
- The allow branch emitted a structured `tool_use` for the exact canonical `sharedSkillsRootPath()` scaffold command and created `.omo/drafts/qa-slug.md` only below the temporary fixture directory.
- The D5 branch changed `disabled_hooks` to include `prometheus-md-only`. Its `bash: "deny"` permission made Bash unavailable to the agent. The structured invalid-tool event names `bash` and reports `unavailable tool`; the fake-server request log independently records the exact proposed scaffold command. No fixture draft was created.
- `opencode-qa/isolation.txt` records matching `host_before` and `host_after` session counts. The driver did not create or modify a host database.
- `opencode-qa/qa-pass.txt` records `ALL OPENCODE QA ASSERTIONS PASSED`.
- This evidence supersedes the false claim in `.omo/evidence/20260718-atlas-grok45-review/verification.txt` that fallback-chain failures were pre-existing. The targeted chain suites now pass, as recorded in `unit-chains.txt`.

## Why It Is Enough

- The live driver proves the command boundary that unit tests cannot: untrusted `node -e` is blocked before execution, the only trusted package-rooted realpath scaffold can execute, and disabling the hook removes Bash from the agent surface.
- Defense in depth is restored for Oracle D5: OpenCode permission layer keeps the pattern map when the hook is enabled (coarse filter: only commands matching `*scaffold-plan.mjs*` are candidates); `prometheus-md-only` remains SoT for trusted realpath and strict argv. Disabled-hook `bash: "deny"` intentionally hides Bash.
- Key order matters on OpenCode 1.18.3: `PermissionNext.disabled()` hides a tool when the last rule for that permission is `pattern: "*"` + `action: "deny"`. Catch-all deny must be first; specific allow last. With that order, bash stays visible and command-time evaluation still denies non-scaffold commands.
- The trust boundary accepts only bare runtime tokens (`node` or `bun`) and canonicalizes the scaffold script. Bare-runtime PATH resolution remains an intentional residual platform trust boundary.

## What Was Omitted

- Raw environment dumps, provider headers, and fake server request bodies were omitted. The checked-in fake response uses no provider credential beyond the synthetic `fake-key`.
- An earlier driver attempt failed the host-count assertion while unrelated host activity increased the count. The final clean rerun is the recorded result and has matching before/after counts.
- An intermediate F1/F3 restore attempt with allow-first / deny-last key order failed live QA (`unavailable tool 'bash'` on the deny probe). That order is rejected; the catch-all-first order is the recorded fix.
