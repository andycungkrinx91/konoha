# QA Exploratory Checklist

> [!NOTE]
> For standard exploratory procedures, load `agent-browser skills get dogfood`.
> This document specifies Konoha-specific invariants and token-efficient constraints.

## Konoha Exploration Invariants

1. **Pre-Flight Scoping**:
   - Only probe routes, form controls, and test IDs previously identified by Genin with explicit `file:line` source citations.
   - Never browse unverified arbitrary endpoints.

2. **Scoped Snapshot Protocol**:
   - Begin with `snapshot -i -c -s "#main"` or specific container selector.
   - For state transitions (e.g. form submission, dialog opening), use `diff snapshot` or targeted checks: `get text`, `is visible`, `wait --text`.
   - Never execute bare unconstrained `snapshot`.

3. **Console & Network Error Triage**:
   - Check `errors` and `console` after each page interaction.
   - Check `network requests --status 4xx` and `network requests --status 5xx` to identify unhandled backend API failures.

4. **Termination Criteria**:
   - Cease exploration within an area after 15 actions if no defect or regression is found.
   - Cap maximum captured output at 4,000 characters per interaction.
