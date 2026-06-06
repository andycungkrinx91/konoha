---
name: kage-architecture
description: Guidelines for high-level software architecture, risk assessment, and technical strategy.
tags:
  - architecture
  - strategy
  - risk
  - security
---

# Kage Architecture & Strategy Guide

This skill governs high-level software design, dependency auditing, and mitigation strategy reviews.

## Core Directives

1. **Trade-Off Analysis**: Document architectural choices using comparative tables or pros/cons matrices.
2. **Blast Radius Assessment**: Analyze security risks, third-party dependency trust levels, and system failures.
3. **Guardrail Enforcements**: Enforce session boundaries, session isolation rules, and token usage optimization budgets.

## Architecture Auditing

- Review system dependencies to prevent CVE exposure.
- Enforce strict database transaction scopes.
- Map out complex microservice interfaces.
