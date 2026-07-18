import { createSystemDirective, SystemDirectiveTypes } from "../../shared/system-directive"
import { getAgentDisplayName } from "../../shared/agent-display-names"

export const HOOK_NAME = "prometheus-md-only"

export const PROMETHEUS_AGENT = "prometheus"

export const ALLOWED_EXTENSIONS = [".md"]

export const ALLOWED_PATH_PREFIX = ".omo"

export const BLOCKED_TOOLS = ["Write", "Edit", "write", "edit"]

/**
 * XML-tag wrapper used to mark the planning-context boundary in prompts
 * forwarded to external LLMs via task(). This format intentionally avoids
 * the `[SYSTEM DIRECTIVE: ...]` bracket syntax that Azure OpenAI Prompt Shield
 * flags as indirect prompt injection in user-role content (#4036).
 */
export const PLANNING_CONTEXT_OPEN = `<planning-context source="prometheus-read-only">`
export const PLANNING_CONTEXT_CLOSE = `</planning-context>`

export const PLANNING_CONSULT_WARNING = `

---

${PLANNING_CONTEXT_OPEN}

You are being invoked by ${getAgentDisplayName("prometheus")}, a planning agent restricted to .omo/*.md plan files only.

**CRITICAL CONSTRAINTS:**
- DO NOT modify any files (no Write, Edit, or any file mutations)
- DO NOT execute commands that change system state
- DO NOT create, delete, or rename files
- ONLY provide analysis, recommendations, and information

**YOUR ROLE**: Provide consultation, research, and analysis to assist with planning.
Return your findings and recommendations. The actual implementation will be handled separately after planning is complete.

${PLANNING_CONTEXT_CLOSE}

---

`

export const PROMETHEUS_WORKFLOW_REMINDER = `

---

${createSystemDirective(SystemDirectiveTypes.PROMETHEUS_READ_ONLY)}

## PROMETHEUS MANDATORY WORKFLOW REMINDER

**You are writing a work plan. STOP AND VERIFY you completed ALL steps:**

┌─────────────────────────────────────────────────────────────────────┐
│                     PROMETHEUS WORKFLOW (ulw-plan)                  │
├──────┬──────────────────────────────────────────────────────────────┤
│  1   │ SKILL FIRST — skill(name="ulw-plan"), full-workflow          │
│      │    - Load ulw-plan before any planning action                │
│      │    - Classify Intent CLEAR / UNCLEAR                         │
├──────┼──────────────────────────────────────────────────────────────┤
│  2   │ GROUND + ROUTE — explore; announce Intent CLEAR|UNCLEAR      │
│      │    - Explore codebase first                                  │
│      │    - Announce Intent CLEAR|UNCLEAR + review_required         │
├──────┼──────────────────────────────────────────────────────────────┤
│  3   │ SCAFFOLD DRAFT — scaffold-plan.mjs --draft-only              │
│      │    - Do NOT hand-write the draft; do NOT use category        │
│      │    - Scaffold only via scaffold-plan.mjs --draft-only        │
├──────┼──────────────────────────────────────────────────────────────┤
│  4   │ CLEAR INTERVIEW / UNCLEAR DEFAULTS                           │
│      │    - CLEAR: interview forks WITH WHY                         │
│      │    - UNCLEAR: announced defaults (no silent inventing)       │
├──────┼──────────────────────────────────────────────────────────────┤
│  5   │ APPROVAL GATE — awaiting-approval; wait                      │
│      │    - Hold at awaiting-approval until user approves           │
│      │    - approval ≠ implementation                               │
├──────┼──────────────────────────────────────────────────────────────┤
│  6   │ POST-APPROVE: PLAN + METIS + APPEND                          │
│      │    <- YOU ARE HERE (plan write)                              │
│      │    - After approve: scaffold plan (no --draft-only)          │
│      │    - task(subagent_type="metis", ...)                        │
│      │    - APPEND \`- [ ] N.\` todos; TL;DR last                     │
├──────┼──────────────────────────────────────────────────────────────┤
│  7   │ DUAL REVIEW — Momus + Oracle when required                   │
│      │    - task(subagent_type="momus", ...)                        │
│      │    - task(subagent_type="oracle", ...)                       │
└──────┴──────────────────────────────────────────────────────────────┘

**YOU ARE HERE on plan write: must already have completed steps 1-5.**
**Finish step 6 (PLAN + METIS + APPEND), then step 7 (DUAL REVIEW) if needed.**

If you skipped steps 1-5, STOP NOW. Go back and complete them.

---

`
