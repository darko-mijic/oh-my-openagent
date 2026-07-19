# QA Evidence: Grok supportsThinking snapshot collision fix

## What was tested
- Unit: model-core capability resolution + settings compatibility on production bundled-snapshot path
- Reproduction proof: getBundledModelCapabilitiesSnapshot + grok-4.5 supplemental reasoning:true must NOT enable Anthropic thinking

## What was observed
- Before fix (reproduced on pre-fix code): supportsThinking=true (source bundled-snapshot); thinking block kept
- After fix (HEAD cdb95d40c): supportsThinking=false (source heuristic); thinking dropped; reasoningEffort high kept; reasoning true kept

## Why sufficient
- Covers the exact production path OpenCode uses (bundled snapshot wrapper merges supplemental entries)
- Regression tests fail closed if snapshot reasoning re-enables thinking for Grok again

## Scope
- Landed on feat/grok-4.5-basic-support only (experimental Grok 4.5 branch)
- Not opened as public PR to dev

## Commits
- 5d5ffb210 fix(model-core): keep Grok off Anthropic thinking on bundled snapshot path
- cdb95d40c test(model-core): pin Grok bundled-snapshot thinking opt-out
