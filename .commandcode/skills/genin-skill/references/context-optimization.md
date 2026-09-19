# Context Optimization

> Load when: optimizing token usage, designing progressive loading strategies, or improving agent efficiency.

## Principles

1. **Load only what's needed** — use reference router, not full inline.
2. **Read narrowly** — target specific files, not entire directories.
3. **Summarize before expanding** — get an overview, then drill into details.
4. **Avoid repeated reads** — read once, extract what you need, reference by memory.
5. **One task per prompt** — compound tasks waste tokens on confusion.
6. **Ask for brief rationale** — not chain-of-thought reasoning.

## File selection strategy

| Goal | Strategy |
|------|----------|
| Understand a repo | Read directory listing → README → entrypoint → expand as needed |
| Find a symbol | Grep first → read only the matching files |
| Review a change | Read diff → read full file only for context around changed lines |
| Research a topic | Decompose into search angles → parallel search → process results |

For large codebases, prefer `rg`, targeted `find -maxdepth`, file-size checks, and range reads. Never use `git grep` or any `git` command. Exclude heavy/generated paths by default: `.git`, `node_modules`, `vendor`, `dist`, `build`, `.next`, `.svelte-kit`, `coverage`, `.cache`, `target`, `__pycache__`, `.venv`, `venv`, `storage/logs`, `tmp`, and `logs`.

## Progressive loading

```
Level 1: Directory tree + README (cheap)
  ↓ need more?
Level 2: Config files + entrypoints (medium)
  ↓ need more?
Level 3: Specific modules relevant to task (targeted)
  ↓ need more?
Level 4: Full files with line-level analysis (expensive)
```

Stop at the lowest level that answers the question.

## Token-saving patterns

| Instead of | Do this |
|-----------|---------|
| Reading entire file | Read summary/header, then specific sections |
| Reading all references | Load only the reference matching the task domain |
| Reading whole repositories | Search first, then read only relevant files/ranges |
| Pasting command output | Summarize findings and cite paths/line ranges |
| Repeating file content in output | Cite file:line, don't paste |
| Long explanations | Tables, checklists, decision trees |
| Chain-of-thought in output | Brief rationale or decision summary |
| Multiple related questions | One focused question per prompt |

## SKILL.md design rules

For skill authors:
- Keep SKILL.md under 100 lines — it's always loaded.
- Move detailed guidance into `references/` files.
- Use a reference router table for load-on-demand.
- Add "load only when" notes to each reference.
- Use tables over prose for structured information.
- No examples longer than 5 lines unless preventing a common mistake.
- No tutorials — link or reference external docs.
