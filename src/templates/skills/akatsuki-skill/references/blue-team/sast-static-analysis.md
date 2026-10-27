# Static Application Security Testing (SAST) Reference

Static Application Security Testing (SAST) evaluates source code without execution to identify security flaws, code smells, insecure deserialization, SQL injection, XSS vectors, and path traversal defects.

## Source
- Primary: `https://www.skills.sh/agentsecops/secopsagentkit/sast-semgrep`
- Reference: `src/workflow/akatsuki/blue_workflows.js` (Phase 5)

## When to Use
- Pre-Commit & Pre-Review Auditing: scan modified files during feature development and refactoring turns.
- OWASP Top 10 Hygiene: detect hardcoded credentials, unsafe shell calls, eval injections, and insecure regexes.
- Language-Specific Audits: evaluate JavaScript, TypeScript, Python, and shell scripts for idiomatic security patterns.

## Konoha Host Inspection
- Execution Surface: Direct host repository inspection (Blue-Team mode)
- Target Files: Git modified files (`--changes`) and core controller/API directories
- Key Invariants:
  1. Parameterized Queries: All database queries must use prepared statements (no string concatenation).
  2. Input Sanitization: User inputs must be validated at boundary controllers before downstream dispatch.
  3. Safe Spawning: Subprocesses must pass discrete argument arrays rather than string command lines.

## Audit Workflow
```bash
# 1. Run local security linter on modified files
npx aislop scan --changes

# 2. Verify zero SQL injection vulnerabilities in prepared statements
node tests/test_akatsuki_security_centralization.js
```

## Fail-Closed Notes
- Code changes introducing high-severity SAST findings block the Kage delivery review gate.
- Remediation tasks are dispatched to Anbu or Jonin for immediate resolution before release.
