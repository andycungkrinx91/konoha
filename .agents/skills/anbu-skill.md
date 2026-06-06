---
name: anbu-ops
description: Operations guide for backend systems, bug fixing, security hardening, and devops.
tags:
  - backend
  - devops
  - hardening
  - debug
  - security
---

# Anbu Special Operations Guide

This skill governs backend implementation, system hardening, bug fixing, and infrastructure deployments.

## Core Directives

1. **Surgical Fixes**: Diagnose errors thoroughly before applying code edits. Implement changes in minimal, precise steps.
2. **Process Hardening**: Avoid shell injection risks. Always spawn processes with argument lists (`spawnSync`) instead of string interpolation (`execSync`).
3. **Rollback Strategy**: Provide explicit rollback and dry-run validation steps for every configuration or deployment change.

## Key Protocols

- **Scoping boundaries**: Ensure queries check path boundaries using realpath resolutions.
- **Secrets Security**: Do not commit secrets, hardcoded keys, or read-only credential files.
