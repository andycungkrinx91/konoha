# Code Review

> Load when: reviewing diffs, PRs, or changed code for correctness, security, and quality issues.

## Review workflow

1. **Parse diff** — extract changed files, added/modified lines, detected domains.
2. **Detect domains** — auto-detect backend vs frontend from file paths.
3. **Review changed code** — scope feedback to diff lines first. Read only necessary surrounding ranges; open full files only when size and context justify it.
4. **Impact analysis** — check if changes affect exports, APIs, shared types, or config.
5. **Document findings** — record each issue with severity, location, and recommendation.
6. **Finalize** — produce summary with prioritized findings.

## Severity labels

| Severity | Criteria | Action |
|----------|----------|--------|
| Critical | Security vulnerability, data loss risk, auth bypass | Must fix before merge |
| High | Broken functionality, async bugs, missing error handling | Should fix before merge |
| Medium | Code quality, duplication, missing types | Fix in this PR or follow-up |
| Low | Style, TODO comments, naming suggestions | Optional improvement |

## Generic checks (all domains)

### Security fundamentals
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] No `eval()`, `exec()`, `new Function()` with external input
- [ ] No `shell=True` with user-controlled input
- [ ] No unvalidated file paths or URLs

### Code quality
- [ ] No debug statements (`console.log`, `print()`) in production code
- [ ] No empty catch/except blocks (must log or rethrow)
- [ ] No placeholder implementations (TODO, NotImplemented)

### LLM code smells
- [ ] No overly generic abstractions without reuse justification
- [ ] No placeholder return values (`return None`, `return {}`)

### Impact analysis
- [ ] Changed exports/interfaces — search for affected imports
- [ ] Modified API signatures — check for callers
- [ ] Altered shared types — search for usages
- [ ] Config/schema changes — find dependent code

### Simplification
- [ ] No duplicate logic (extract shared functions)
- [ ] No deep nesting (>3 levels — use early returns)
- [ ] Use idiomatic patterns for the language

## Finding format

```markdown
### [{CATEGORY}] {Item Name}

**Severity**: Critical | High | Medium | Low
**File**: `path/to/file.ext`
**Line(s)**: 42-48

**Issue**: {what's wrong}
**Code**: `snippet from diff`
**Recommendation**: {how to fix}
```

## Summary template

```markdown
## Code Review Summary

**Files changed**: {count}
**Domains**: {backend, frontend, config}

### Critical (must fix)
1. {issue}

### High (should fix)
1. {issue}

### Recommendations
{overall guidance}
```

## Domain routing

When diff contains backend files → also load `references/backend-review.md`
When diff contains frontend files → also load `references/frontend-review.md`
