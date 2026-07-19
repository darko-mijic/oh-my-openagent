# Evidence: 20260718-grok45-fable-review-fixes

Plan: grok45-fable-review-fixes on `feat/grok-4.5-basic-support`.
Task 12 finalized evidence gathered through todos 2-11. The pack was committed
in the later evidence-only commit `f3058f041`.

## WHAT WAS TESTED

- Targeted Bun tests cover model-family detection and capabilities, Grok agent
  shape and guidance, runtime fallback, background agent propagation, and both
  runtime prompt reconcilers. See `unit-targeted.txt`.
- `bun run typecheck` covers the repository and workspace package projects.
  See `typecheck.txt`.
- `bun run test:codex` covers the Codex Light gate. See `test-codex.txt`.
- A rebuilt local `dist/index.js` is driven through an isolated OpenCode HTTP
  server, `opencode run --attach --format json`, SSE stream, and local fake
  OpenAI Responses server. See `opencode-qa/run-isolated.sh`.

## WHAT WAS OBSERVED

- Task 1 hygiene is recorded in `task-01-hygiene-status.txt`.
- The task-12 command outputs and OpenCode observations are recorded in the
  corresponding files named above, including the host database before/after
  count in `opencode-qa/isolation.txt`.
- The isolated server registered `Atlas - Plan Executor` with its baked
  `openai/gpt-fallback` model. `opencode-qa/agent-list.json` is the complete
  `/agent` response and `atlas-registration.json` is its Atlas projection.
- The live Grok request contained the Atlas overlay:
  `opencode-qa/system-transform-atlas-grok.json` records
  `experimental.chat.system.transform`, `grok-4.5`, and `true`.
- The fake model returned one 429 for Grok. SSE records `session.status` retry,
  `message.updated`, a Model Fallback toast, the model change to
  `gpt-fallback`, and the fallback `QA_FALLBACK_OK` response. The concise
  result is in `opencode-qa/runtime-fallback-low-effort.json` and the raw SSE
  event stream is in `opencode-qa/sse-session-error-and-message-updated.jsonl`.
  That filename is historical and overstates the capture: it contains
  `session.status` plus `message.updated`, not `session.error`. See
  `opencode-qa/sse-filename-errata.txt`.
- `opencode-qa/run-atlas-grok-fallback.jsonl` is empty because attach mode
  emitted no stdout JSONL. It is not used as proof. The authoritative live-run
  artifacts are the SSE stream, sanitized provider requests, and `qa-pass.txt`.
  See `opencode-qa/run-atlas-grok-fallback.note.txt`.
- The stale Atlas full-suite attribution is corrected in
  `../20260718-atlas-grok45-review/verification.txt`; the related claim fixes
  are in `../20260718-grok45-review-claim-fixes/`.

## WHY IT IS ENOUGH

- The focused suite covers the changed contracts at detector, factory,
  reconciliation, runtime fallback, and background dispatch seams; repository
  typecheck and the Codex suite provide cross-package gates.
- The isolated OpenCode exercise verifies the branch build loads without using
  host state, registers Atlas, applies the runtime Grok system transform, and
  switches models from the provider retry signal to deliver the fallback text.
- Residual risks intentionally remain: Sisyphus same-family 4.3 to 4.5 does
  not reapply the 4.5-only harness overlay; Prometheus scaffold still trusts
  bare-runtime PATH; absent user reasoningEffort and unmappable variant may
  leave effort unset; Grok Junior routes only through the GPT-5.5 template.
- Fallback cooldown keys are entry-indexed. This permits a chain entry whose
  model matches the just-failed model to be attempted once, consuming one
  fallback attempt before the chain advances.
- The fallback configuration carries `reasoningEffort: "low"`. The sanitized
  fake-provider record did not expose an effort-valued request field for this
  OpenCode provider path, so this pack proves configured propagation and model
  switching, not a provider-wire assertion for the low effort value.

## WHAT WAS OMITTED

- Raw provider credentials, authorization headers, environment dumps, and
  model request bodies are omitted. `opencode-qa/opencode-serve.log` contains
  only the isolated listening address; the fake-model record is sanitized.
- A pre-stage secret review scans this pack and the listed 20260718 prior
  packs. Any matching raw secret-bearing material is redacted or omitted, with
  the scan result recorded in `secret-review.txt`.
- Matrix C is not claimed complete. Generated `assets/oh-my-opencode.schema.json`
  and `packages/omo-codex/scripts/install-dist/install-local.mjs` are not staged.
- Clean `dev` has a pre-existing installer-version mismatch: root
  `package.json` is `4.19.0`, while committed `install-local.mjs` embeds
  `4.18.2`. The resulting `script/codex-installer-version.test.ts` failure is
  upstream drift and is outside this feature branch's product scope.
