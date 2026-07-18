# Atlas Grok 4.5 review QA

## What was tested

- Built the current repository with `bun run build` and loaded `dist/index.js` into OpenCode 1.18.3 through an isolated `OPENCODE_CONFIG_DIR` and XDG sandbox.
- Started the real OpenCode HTTP server and invoked `/start-work .omo/plans/qa-plan.md` twice through `POST /session/:id/command`.
- Inspected the live command registry, session messages, SSE stream, sandbox Boulder state, model usage, and host OpenCode database count.
- Ran the affected hook and agent suites, repository typecheck, build, and full test suite.

## What was observed

- OpenCode registered exactly one `start-work` command with source `command`.
- Both command requests returned HTTP 200 and produced assistant turns with non-zero token usage.
- The resolved command context contained `Scope: builtin`, proving the native OpenCode command won over the shared skill collision.
- The first invocation created one Boulder work. The second invocation left the work count at one.
- The first turn emitted the auto-selected-plan context and the second recognized the same completed plan instead of creating another work.
- The SSE stream delivered 154 `message.part.updated` events and the server logged zero errors.
- The isolated sandbox created two sessions. The real host database stayed at 79 sessions before and after.

Exact summarized output is in `opencode-command-qa.txt`. Automated verification is in `verification.txt`.

## Why it is enough

The QA drives the same public command surface that created the reported duplicate works, with a path-form plan argument and two independent command invocations. It verifies the command selected by OpenCode, the persisted Boulder work count, a real model turn, lifecycle events, and host isolation. Focused regressions separately pin quoted task-checkbox parsing and Grok effort preservation.

## What was omitted

- Raw session responses and full prompts were summarized because they contain large generated model content and unrelated advertised skills.
- TUI smoke was omitted because `tmux` is not installed. The command and hook behavior was asserted through the structured HTTP API and SSE stream instead.
- Docker QA was unavailable because Docker is not installed, so the documented isolated local fallback was used.
- TypeScript LSP diagnostics were unavailable because the server was previously declined; `bun run typecheck` passed as the static substitute.
