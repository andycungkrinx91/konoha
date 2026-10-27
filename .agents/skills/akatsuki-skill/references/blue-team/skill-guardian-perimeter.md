# Skill Guardian Perimeter Defense Reference

The Skill Guardian Perimeter Defense workflow evaluates skills, prompts, scripts, and agent extensions against a strict pattern engine to prevent destructive commands, reverse shells, and malicious tool invocations.

## Source
- Primary: `https://www.skills.sh/terminalskills/skills/security-audit`
- Reference: `src/workflow/kage-reviewer/skill_guardian.js`
- Workflow: `src/workflow/akatsuki/blue_workflows.js` (Phase 2)

## When to Use
- Skill Installation Defense: audit third-party skills before copying to live directories.
- Repository Perimeter Verification: scan all files under `.agents/skills/`, `.cursor/skills/`, `.omp/skills/`.
- Prompt & Command Analysis: intercept destructive or obfuscated scripts before execution.

## Core Rules & Risk Scores
| Rule ID | Severity | Impact | Description |
|---|---|---|---|
| `DESTRUCTIVE_COMMAND` | Critical | 100 | Filesystem wipe (`rm -rf` root, disk format, mkfs) |
| `REVERSE_SHELL` | Critical | 100 | Socket-based reverse shell payloads and pty spawns |
| `REMOTE_CODE_EXECUTION_PIPE` | Critical | 70 | Untrusted remote script piped directly into shell |
| `CREDENTIAL_HARVESTING` | Critical | 80 | Unauthorized reads of SSH keys, shadow files, tokens |
| `ENV_EXFILTRATION` | High | 50 | Exfiltration of process environment variables |
| `OBFUSCATED_CODE_EXECUTION` | High | 60 | Eval with base64 decoding, hex payloads, char codes |

## Invariants
- Fail-Closed Threshold: Risk score must be strictly $\le 30$ and contain 0 Critical findings.
- Automatic Quarantine: Unsafe skills are rejected and never deployed to client agent locations.

## Audit Workflow
```bash
# 1. Run unit test suite for Skill Guardian
node tests/test_skill_guardian.js
```
