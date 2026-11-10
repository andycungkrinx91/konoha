# Konoha Task Message Format

Canonical envelope for every human <-> agent message on every Konoha harness client
(Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi, OMP), and for
every agent <-> agent handoff. One shape, parsed the same way everywhere.

Source of truth for `konoha.get_skill('konoha/task-format')`. The file lives at
`src/templates/skills/konoha/references/task-format.md` and ships to all client skill
directories through `src/global_skill_sync.js`. If `get_skill` returns anything
different, re-run `konoha migrate` and report it.

## Inbound envelope (human -> agent)

```
**Feedback
1. <the human's reply to the last gate, verdict, or report>

**Task
1. <what must be built, fixed, or answered>

**Rules
1. <constraint that applies to this task>
```

- Every section is a numbered list. One action or fact per item, in execution order.
- Section order is fixed: Feedback, Task, Rules. Never reorder, never merge sections.
- A section with nothing to say is omitted. An empty numbered item is a defect, not a placeholder.
- Agents accept `** Feedback`, `** Feedback:`, and `**Rules:` on input and normalize to
  the bare headings above. Match with `/^\*\*\s*(Feedback|Task|Rules)\s*:?\s*$/im`.
- Multiple consecutive lists are one section. Only a recognized heading starts a new one.

### What belongs in each section

| Section | Holds | Never holds |
|---|---|---|
| Feedback | The human's verbatim reply to a gate or report, corrections, accepted deviations | Restated task scope, agent-authored summaries of the human's words |
| Task | The deliverable, its acceptance criteria, the order to do it in | Rationale essays, design notes the agent is expected to invent |
| Rules | Constraints that bind this task and are not already canonical | Copies of the standing contract rules |

### Rules section contract

The standing rules are the 26 canonical rules in
`src/templates/skills/konoha/references/contract.md`. They apply to every
task without being restated. `konoha.get_skill('konoha/contract')` returns the
runtime rendering of the same document (agent header plus the numbered rules), so
read that when the task needs the rules inline. The `**Rules` section carries only
task-level deltas: pinned paths, excluded scope, environment or client restrictions,
release authorization, and one-off evidence requirements.

When a `**Rules` item contradicts the canonical contract, the item wins for that task
only, and the agent states the override in its report. When it contradicts a Gate 1
verdict, Gate 1 wins and the agent stops.

Gate verdicts arrive as `**Feedback`. They are submitted verbatim through
`sannin({ task_dir, choice, refinement })` and never renumbered, reworded, or merged
into the task.

## Outbound envelope (agent -> human)

```
**Result
1. What was done, in the same order as the Task items.

**Evidence
1. Command run and its observed outcome, file and line, or test name and result.

**Blockers
1. What is unreachable and what was tried. Omit the section when empty.

**Next
1. The single next action, or the decision the human must make.
```

- `**Result` answers the Task item by item. A partial item is reported as partial.
- `**Evidence` contains only exercised verification. Unverified claims are marked
  `[INFERENCE]` or left out. Fabricated evidence is a contract violation.
- `**Next` names one action. It is not a summary and not a status line.

## Cross-client invariants

- Headings, numbering, and section order are fixed. A client that renders the envelope
  keeps all three, whatever its formatting layer does underneath.
- Subagents receive the envelope in structured MCP arguments and reply with the
  outbound envelope. A reply that reads like a report but skips the headings is
  incomplete and gets sent back.
- Long-running work streams progress inside `**Result`. It does not open a second
  narrative channel.

## Enforcement status

This file defines the convention. No parser or formatter enforces it: the headings
are read by the dispatching agent, not by code. Client instruction files embed the
lightweight contract, which does not carry the envelope line; a client sees it after
fetching `konoha/contract` on demand.