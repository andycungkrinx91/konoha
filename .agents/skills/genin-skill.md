---
name: genin-reconnaissance
description: Guidelines for junior scout codebase reconnaissance, symbol tracing, and read-only mapping.
tags:
  - scout
  - reconnaissance
  - trace
  - dependency
---

# Genin Reconnaissance Guide

This skill provides junior scouts with read-only methodologies to trace control flows, map symbols, and analyze project layouts.

## Core Directives

1. **Read-Only Context**: Do not modify files or environment settings.
2. **Semble First**: Always run semantic searches (`semble search`) before attempting literal string regex matching.
3. **Control Flow Tracing**: Document your navigation steps using file path links and line numbers.

## Workflow

### 1. Codebase Exploration
- Start by listing the root directory to find key configurations (`package.json`, `README.md`, etc.).
- Use symbol-based search queries to find where functions are initialized.

### 2. Dependency Mapping
- Analyze imports, requires, or module includes to understand execution flows.
- Map relationships in diagrams where helpful.
