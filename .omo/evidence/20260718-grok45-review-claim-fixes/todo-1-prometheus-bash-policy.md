# Todo 1: Prometheus bash policy QA

## What was tested

- `bun test packages/omo-opencode/src/hooks/prometheus-md-only/bash-command-policy.test.ts`
- `bun run tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts` against the three changed TypeScript files.
- `bun run build`
- A direct Bun import driver using the package-discovered trusted script for one valid command and one `$HOME` attack.
- `bash .agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test` against an isolated real OpenCode server.

## What was observed

- Policy matrix: 51 passed, 0 failed. It covers every planned allow/deny row, trusted and escaping symlinks, malicious cwd discovery, quote concatenation, unbalanced quotes, exact runtimes, every `$` form, shell metacharacters, and scaffold argument grammar.
- Package typecheck exited 0 with no output. The no-excuse audit reported `No violations in 3 file(s).`
- Direct runtime result was `{"happy":true,"attack":false}`.
- The full build completed with `build: all steps completed`.
- The first isolated OpenCode probe observed `{"type":"server.connected"}` and printed `PASS: SSE /event opened and delivered server.connected`.
- Host session count was 128 before and 128 after a bounded repeated probe attempt. No `opencode serve` or probe process remained.

## Why it is enough

The unit matrix executes the exact policy seam with real filesystem canonicalization and the default package-root trust source. The direct driver independently exercises production defaults. Package typechecking and the full build cover import and bundling integration. The isolated OpenCode probe confirms the real host event plumbing while preserving the host database.

## What was omitted

The full fake-model Prometheus tool-call QA, including disabled-hook behavior, belongs to locked plan Todo 8 after Todo 2 wires the disabled-hook permission. Repeated SSE self-test invocations hung during curl cleanup despite the first clean pass; bounded termination left no process or host DB change. No secrets, tokens, auth headers, or raw environment dumps are included.
