# Architecture Analysis

> Load when: evaluating system boundaries, coupling, scalability, maintainability, migration risk, or producing architecture decision records.

## Analysis framework

Evaluate architecture across these dimensions:

| Dimension | Key questions |
|-----------|--------------|
| **Boundaries** | Are service/module boundaries clear? Who owns what? |
| **Contracts** | Are API contracts explicit (types, schemas, versioning)? |
| **Dependencies** | Is coupling loose? Are dependency directions clean? |
| **Scalability** | Can components scale independently? What are bottlenecks? |
| **Reliability** | What are SPOFs? How does the system degrade? |
| **Observability** | Are metrics, logs, and traces sufficient for debugging? |
| **Security** | Is the attack surface minimized? Is auth consistent? |
| **Maintainability** | Can teams change code safely? Is test coverage adequate? |
| **Data flow** | How does data move through the system? Where is state? |

## Analysis workflow

1. **Map the system** — identify components, data stores, external dependencies.
2. **Trace data flows** — follow a request from entry to storage and back.
3. **Identify boundaries** — service boundaries, module boundaries, trust boundaries.
4. **Assess coupling** — find tight coupling (shared databases, circular imports, hardcoded URLs).
5. **Evaluate qualities** — apply the dimension table above.
6. **Identify risks** — SPOFs, migration risks, scalability limits.
7. **Recommend** — prioritize by risk × effort.

## Coupling indicators

| Smell | Risk | Remedy |
|-------|------|--------|
| Shared database between services | High | Split schemas, use APIs |
| Circular imports | Medium | Extract shared module |
| Hardcoded service URLs | Medium | Service discovery / config |
| Shared mutable state | High | Event-driven, message queue |
| Synchronous chains (A→B→C→D) | High | Async, circuit breakers |
| God module (>1000 LOC, mixed concerns) | Medium | Split by responsibility |

## Migration risk assessment

When evaluating proposed changes:

- [ ] What breaks if this change fails? (blast radius)
- [ ] Can it be rolled back? How fast?
- [ ] What data migrations are needed? Are they reversible?
- [ ] What downstream consumers are affected?
- [ ] Can the change be deployed incrementally?
- [ ] What monitoring should be added before/during migration?

## Output format: Architecture Decision Record (ADR)

```markdown
# ADR-NNN: {Title}

## Status
Proposed | Accepted | Deprecated

## Context
{Why this decision is needed — current state, problem, constraints}

## Options Considered
1. {Option A} — pros, cons
2. {Option B} — pros, cons

## Decision
{What we chose and why}

## Consequences
- Positive: {benefits}
- Negative: {tradeoffs}
- Risks: {what could go wrong}
```

## Rules

- Do not suggest rewrites unless the current architecture has critical issues.
- Cite concrete code evidence for architecture concerns.
- Separate "nice to have" from "blocking risk".
- Propose incremental improvements over big-bang migrations.
- Document assumptions and open questions.
