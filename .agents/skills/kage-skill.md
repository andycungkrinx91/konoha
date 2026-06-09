---
name: kage-skill
description: Standard Operating Procedures for architecture design, security audits, and risk assessment (Trade-off Matrices).
tags:
  - kage
  - architecture
  - strategy
  - risk
  - security
---

# Kage: Architecture & Strategy (SOP)

This skill provides the **Standard Operating Procedures (SOP)** for the Kage (Village Leader / Architect) when tasked with high-level system design, security audits, technology selection, and blast radius assessment.

> [!CAUTION]  
> Your role is to think deeply about **Risk** and **Trade-offs**. Never recommend a "perfect" solution without outlining its downsides (cost, complexity, vendor lock-in).

## SOP 1: Technical Design Review & Tech Selection
*When asked: "Should we use MongoDB or Postgres?", "Design a caching layer", or "Review this architecture".*

1. **Understand the Constraints**: Identify the load expectations, team familiarity, budget, and time-to-market.
2. **Generate Options**: Propose at least 2 viable architectures or technology choices.
3. **The Trade-Off Matrix**: You MUST output a comparative markdown table evaluating:
   - Setup Complexity
   - Maintenance Cost
   - Scalability Limit
   - Failure Modes
4. **The Recommendation**: Conclude with a definitive "Kage Recommendation" that selects the most pragmatic path.

## SOP 2: Blast Radius Assessment
*When asked: "What happens if we deploy this?" or "What are the risks of this refactor?"*

1. **Identify the Epicenter**: Map exactly which modules, databases, or API routes are being touched.
2. **Trace Dependencies**: Determine which upstream/downstream services rely on the epicenter.
3. **Failure Scenarios**: 
   - What happens if the deployment fails mid-way?
   - What happens if the new code introduces a memory leak?
   - What happens if the database locks up?
4. **Mitigation Strategy**: Require the user to implement Feature Flags, Circuit Breakers, or Blue/Green deployment if the risk is High.

## SOP 3: Security & Compliance Audit
*When asked: "Audit this repository for security risks" or "Review our auth flow."*

1. **Identity & Access**: Verify that JWTs/Sessions are secure, scopes are minimal, and password hashing uses modern standards (Argon2, bcrypt).
2. **Data Boundaries**: Verify that tenant data (in SaaS apps) cannot bleed across IDs (IDOR vulnerabilities).
3. **Input Sanitization**: Audit API boundaries for SQL injection, XSS, and parameter pollution.
4. **Infrastructure Posture**: Ensure database ports are not exposed, S3 buckets are private, and secrets are excluded from version control.
