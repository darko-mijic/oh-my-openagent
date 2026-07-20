# Deviation annotations (MD-10) - grok45-final-review-gates

Date: 2026-07-20
Branch: `feat/grok-4.5-basic-support`
Plan: `.omo/plans/grok45-final-review-gates.md` (not rewritten)

## (a) Commit-strategy deviation

The plan letter required per-todo green commits for todos 1-12. Implementation history collapsed those todos into mega-commit:

- `1392f60b3` - `feat(atlas): final-wave reviewer role enforcement and bypass hardening`

History is immutable per plan (no rewrite). Per-commit-green is therefore unverifiable for the collapsed range: intermediate trees between todos 1-12 were never recorded as separate commits.

Final tree verification (post-implementation gates, recorded under task-10/task-15 evidence and re-checked during Batch D):

- root `bun test`: 12,086 pass (task-15 / F2 notes)
- `bun run typecheck`: clean
- focused final-wave and agent suites green on the landed tree at the time of those gates

This annotation does not claim the collapsed intermediate commits were individually green; it records that the final landed tree was verified green and that history will not be rewritten to reconstruct per-todo commits.

## (b) HI-5 evidence is retrospective

Per-todo evidence files `task-1` through `task-9` and `task-12` under this directory were not captured during the original implementation pass. Batch D backfilled them on 2026-07-20 by re-running the focused suites from the current worktree and marking each file:

```text
# RETROSPECTIVE capture for todo N (HI-5 backfill)
```

Suites come from committed code (plus concurrent in-progress hook edits from Batches A/B/C where those agents own `packages/omo-opencode/src/hooks/**`). Failures in hook-owned files during retrospective capture are attributed to concurrent worktree dirt, not to Batch D doc/model/checklist changes.

## Related letter alignments fixed in Batch D (not history rewrites)

- MD-9: `qa-executor` model chain aligned to plan letter `gpt-5.6-sol high` -> `gpt-5.5 high` -> `claude-opus-4-7 max`
- LO-7: `MAX_AGENTS` set to plan letter `16`
- LO-12: Codex plan-checklist strips trailing `<!-- ... -->` from checkbox labels
- HI-6: documentation inventory updated for 12 agents and `reviewer-scope-guard`
