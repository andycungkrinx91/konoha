# Token Safety

Use this reference when context size, many references, large repos, or multi-domain routing could waste tokens.

## Rules

- Load only the smallest relevant reference set.
- Do not load all references.
- Do not paste huge files or full repo dumps.
- Inspect tree before opening files.
- Search before reading.
- Read file ranges instead of full large files.
- Summarize findings instead of dumping raw output.
- Use router.md only when routing is ambiguous.
- Use workflow references only for multi-step tasks.
- Use quality checklist only for final review, production readiness, security-sensitive tasks, or large changes.
- Avoid duplicate guidance across references.
- Keep SKILL.md as control plane only.
- Load `references/character-hygiene.md` only when syntax-sensitive output could contain accidental non-ASCII, invisible, full-width, smart quote, dash, or homoglyph characters.

## Large file handling

- Use `wc -l` before reading large files.
- Use `sed -n 'start,endp' file`.
- Use `rg` to locate relevant symbols.
- Avoid generated/vendor/cache folders.

## DevSecOps routing notes

- Load only the cloud/provider reference directly involved.
- Load infrastructure workflows only for multi-step, cross-domain delivery.
- Avoid loading every security reference; choose code review, cloud review, senior security, or pentest by intent.

## Bad patterns

Avoid:
- “read all references”
- “load the full repo”
- “cat every file”
- “always use checklist”
- “always load workflow”
