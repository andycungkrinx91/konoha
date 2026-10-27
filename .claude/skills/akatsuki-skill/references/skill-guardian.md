# Skill Guardian Security Engine

The Skill Guardian (`src/workflow/kage-reviewer/skill_guardian.js`) is Konoha's perimeter defense system that inspects all skills, plugins, and custom agent extensions before installation and execution.

## Core Rules & Risk Scores

| Rule ID | Severity | Impact | Description |
|---|---|---|---|
| `DESTRUCTIVE_COMMAND` | Critical | 100 | Unsafe filesystem wipe commands (`rm -rf` root, disk format) |
| `REVERSE_SHELL` | Critical | 100 | Socket-based reverse shell payloads and interactive spawn |
| `REMOTE_CODE_EXECUTION_PIPE` | Critical | 70 | Untrusted remote script download piped into shell interpreter |
| `CREDENTIAL_HARVESTING` | Critical | 80 | Unauthorized reads of private SSH keys, shadow files, cloud tokens |
| `ENV_EXFILTRATION` | High | 50 | Exfiltration of process environment variables or secrets |
| `OBFUSCATED_CODE_EXECUTION` | High | 60 | Eval with base64 decoding, char code arrays, hex payloads |

## Scoring Engine

- **Risk Score**: Sum of impact weights for all matched patterns, normalized 0–100.
- **Fail-Closed Threshold**: Risk score >= 30 or any Critical finding blocks the skill immediately.
- **Auditing**: Akatsuki runs the Skill Guardian during blue-team audits and the Akatsuki Security Final Gate.
