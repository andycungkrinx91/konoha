# Senior QA Engineer Guide (Strategy, Validation, Release Readiness)

## Contents

- QA Mission and Operating Principles
- QA Strategy by Risk
- Test Planning Framework
- Acceptance Criteria Validation (INVEST)
- Test Case Template
- Test Design Techniques
- Testing Types and Execution Basics
- Security Testing Handoff
- CI Gates and Test Pyramid
- Defect Quality Standards
- Release Readiness Workflow
- Risk-Based Go/No-Go Checklist
- Bug Fix Verification Workflow

## QA Mission and Operating Principles

QA ensures software is **fit for purpose**, not just “working on one path.”

Principles:

- Prevent defects early through requirement clarity.
- Focus effort where user/business risk is highest.
- Make quality evidence visible and repeatable.
- Pair fast feedback (smoke checks) with deep confidence (regression + exploratory).

## QA Strategy by Risk

Define strategy per release based on:

- Critical user journeys.
- Data integrity and security impact.
- Change surface area (new features vs refactor).
- Failure blast radius and rollback complexity.

Risk tiers:

- **High risk**: broad regression + API/UI + performance + security signoff.
- **Medium risk**: smoke + targeted regression + exploratory.
- **Low risk**: smoke + focused validation around changed components.

## Test Planning Framework

A solid plan includes:

- Scope in/out.
- Environments and test data strategy.
- Test levels (unit, integration, E2E).
- Roles and ownership.
- Entry/exit criteria.
- Defect triage cadence.
- Evidence/reporting format.

Output format:

- Objective
- Risks
- Coverage matrix
- Schedule
- Gate criteria

## Acceptance Criteria Validation (INVEST)

Check acceptance criteria before execution:

- **I**ndependent: not tightly coupled to hidden dependencies.
- **N**egotiable: leaves room for implementation tradeoffs.
- **V**aluable: maps to user/business value.
- **E**stimable: test effort can be estimated.
- **S**mall: testable within sprint/release scope.
- **T**estable: objective pass/fail is possible.

If criteria fail INVEST, stop and refine before test execution.

## Test Case Template

Use a consistent template:

1. Test ID / Title
2. Requirement or story link
3. Preconditions
4. Test data
5. Steps
6. Expected result(s)
7. Actual result
8. Status (Pass/Fail/Blocked)
9. Evidence (logs/screenshots/video)
10. Notes / defects raised

## Test Design Techniques

Use these intentionally:

- **Equivalence partitioning**: representative values from valid/invalid classes.
- **Boundary value analysis**: min/max and just-inside/outside checks.
- **Decision table testing**: combinational business-rule coverage.
- **State transition testing**: ensure legal/illegal state changes are validated.

Do not rely only on happy-path scripted cases.

## Testing Types and Execution Basics

### Smoke Testing

- Fast checks for core system viability after build/deploy.
- Run first; block deeper suites on smoke failure.

### Regression Testing

- Revalidate existing behavior impacted by changes.
- Scope by risk and dependency graph.

### Exploratory Testing

- Time-boxed sessions to discover unknown risks.
- Use charters tied to high-risk user behaviors.

### API Testing

- Validate status codes, schema, contract, idempotency, error handling.
- Include authz/authn negative tests and rate-limit behavior.

### UI Testing

- Verify critical user paths and state transitions.
- Keep brittle UI selectors under control.

### Performance Testing

- Baseline and compare key SLIs (latency, throughput, error rate, saturation).
- Include realistic data shape and concurrency.

## Security Testing Handoff

QA handoff to security should include:

- Feature scope and sensitive data touchpoints.
- Threat assumptions and abuse cases.
- Test accounts, permissions matrix, and environment details.
- Known limitations and unresolved risk items.

Security signoff should explicitly track critical/high findings and mitigation status.

## CI Gates and Test Pyramid

Preferred pyramid:

- Many unit tests (fast, deterministic).
- Moderate integration/service tests.
- Fewer E2E tests for critical flows.

CI gate examples:

- Unit + integration pass required.
- Smoke pass required before deploy.
- Regression suite required for release candidates.
- Performance/security gates for high-risk releases.

## Defect Quality Standards

A high-quality defect report contains:

- Clear title with affected area.
- Environment/build/version.
- Preconditions and exact repro steps.
- Expected vs actual behavior.
- Frequency and reproducibility.
- Severity/priority with rationale.
- Attachments (logs, screenshots, traces).

Poor-quality bugs increase cycle time and mis-prioritization.

## Release Readiness Workflow

1. Confirm test scope completion vs planned coverage.
2. Review open defects by severity, area, workaround.
3. Validate non-functional criteria (performance, reliability, security).
4. Verify rollback and monitoring readiness.
5. Conduct go/no-go with explicit risk acceptance.

## Risk-Based Go/No-Go Checklist

- [ ] Critical user journeys pass in target environment.
- [ ] No unresolved blocker/critical defects (or explicit risk acceptance documented).
- [ ] Regression coverage meets agreed threshold.
- [ ] Smoke suite stable and repeatable.
- [ ] API/UI contract changes communicated and validated.
- [ ] Performance baseline regression within agreed limits.
- [ ] Security findings triaged with ownership and deadlines.
- [ ] Rollback plan tested and operationally feasible.
- [ ] Monitoring/alerting is ready for release watch period.

## Bug Fix Verification Workflow

1. Reproduce original defect on pre-fix build.
2. Validate fix on target build with same steps/data.
3. Execute negative and adjacent path checks.
4. Re-run relevant regression subset for impacted components.
5. Confirm acceptance criteria and close evidence.
6. Ensure automated test added/updated to prevent recurrence.

Definition of done for defect closure:

- Fix verified,
- No critical side effects found,
- Regression guard in place,
- Evidence attached.
