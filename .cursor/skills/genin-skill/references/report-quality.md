# Report Quality

> Load when: generating formal research reports, architecture reviews, or stakeholder-facing deliverables.

## Report structure

Use `templates/report_template.md` for formal reports. Required sections:

1. **Executive Summary** (50-250 words) — key findings, decision implications.
2. **Introduction** — question, scope, methodology, assumptions.
3. **Main Analysis** (4-8 findings) — each 300-500 words with citations `[N]`.
4. **Synthesis & Insights** — patterns, novel insights, implications beyond sources.
5. **Limitations & Caveats** — gaps, assumptions, uncertainties.
6. **Recommendations** — immediate actions, next steps, further research.
7. **Bibliography** — complete, no placeholders, no ranges.
8. **Methodology Appendix** — process, sources, verification approach.

## Quality checklist

Before delivering a report:

- [ ] Executive summary < 250 words
- [ ] All required sections present and substantive
- [ ] Citations formatted `[1]`, `[2]`, `[3]` — every major claim cited
- [ ] Bibliography matches all in-text citations (no missing, no extras)
- [ ] No placeholder text (TBD, TODO, [citation needed])
- [ ] Word count appropriate for mode (quick: 2K+, standard: 4K+, deep: 6K+)
- [ ] 10+ sources (document if fewer)
- [ ] 3+ sources per major claim
- [ ] No vague attributions ("studies show", "experts believe")
- [ ] Prose-first (>80% prose, <20% bullets)
- [ ] Specific data (numbers, percentages, dates) not vague claims

## Anti-patterns

- ✗ "Research shows..." without citation
- ✗ "Several studies suggest..." — name them
- ✗ "Potentially beneficial" — quantify or cite evidence
- ✗ Bullet-point-only sections — write prose paragraphs
- ✗ Incomplete bibliography ("Additional citations...")
- ✗ Summary sections instead of detailed analysis
- ✗ Fabricated citations to fill gaps

## HTML report generation

For McKinsey-style HTML reports:

1. Use `templates/mckinsey_report_template.html` as base.
2. Convert markdown with `scripts/md_to_html.py`.
3. Replace template placeholders: `{{TITLE}}`, `{{DATE}}`, `{{SOURCE_COUNT}}`, `{{CONTENT}}`, `{{BIBLIOGRAPHY}}`.
4. Verify with `scripts/verify_html.py`.
5. No emojis in final HTML.

## Validation

```bash
python scripts/validate_report.py --report [path]
python scripts/verify_citations.py --report [path]
```

8 automated checks: exec summary length, required sections, citation format, bibliography match, no placeholders, word count, source minimum, no broken links.

If validation fails twice → stop and report issues to user.

## File organization

For research outputs:
```
~/Documents/[TopicName]_Research_[YYYYMMDD]/
├── research_report_[YYYYMMDD]_[slug].md
├── research_report_[YYYYMMDD]_[slug].html
└── research_report_[YYYYMMDD]_[slug].pdf
```
