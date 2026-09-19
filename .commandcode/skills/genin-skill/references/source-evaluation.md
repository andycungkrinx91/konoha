# Source Evaluation

> Load when: assessing source credibility, verifying citations, handling conflicting evidence, or building bibliographies.

## Credibility scoring (0-100)

| Factor | Weight | Scoring criteria |
|--------|--------|-----------------|
| Domain authority | 25% | Established institution (80+), industry blog (50-70), personal blog (20-40) |
| Expertise | 25% | Subject matter expert (80+), general tech (50-70), unverified author (20-40) |
| Recency | 20% | <1 year (90+), 1-3 years (60-80), 3-5 years (40-60), >5 years (20-40) |
| Corroboration | 15% | 3+ independent sources agree (90+), 1-2 sources (50-70), uncorroborated (20-40) |
| Bias potential | 15% | Vendor content (-20), funded research (-10), independent (+10) |

Use `scripts/source_evaluator.py` for automated scoring when processing many sources.

## Source type hierarchy

| Source type | Typical score | Best for |
|-------------|--------------|----------|
| Peer-reviewed papers | 80-100 | Scientific claims, methodology |
| Official documentation | 75-95 | API behavior, technical specs |
| Industry reports (Gartner, etc.) | 70-90 | Market data, trends |
| Conference talks / proceedings | 65-85 | Emerging research, expert opinion |
| Reputable tech publications | 60-80 | General tech news, analysis |
| GitHub repositories | 50-80 | Implementation patterns, adoption data |
| Blog posts (expert authors) | 40-70 | Opinion, tutorials, experience |
| Social media / forums | 20-50 | Signals, sentiment (not evidence) |

## Handling conflicting sources

When sources disagree:

1. **Assess credibility** — higher-credibility source wins for factual claims.
2. **Check recency** — newer data may supersede older data.
3. **Identify scope** — sources may be correct about different contexts.
4. **Document the conflict** — report both positions with citations.
5. **Flag uncertainty** — "Sources disagree: [1] reports X while [2] reports Y."

Do not silently pick one side. Always surface conflicts for the reader.

## Citation format

In-text: `[N]` immediately after the claim.

Bibliography entry:
```
[N] Author/Org (Year). "Title". Publication/Source. URL (Retrieved: YYYY-MM-DD)
```

Rules:
- Every `[N]` in the report body must have a matching bibliography entry.
- No placeholders: never use "[8-75] Additional citations" or "etc."
- No ranges: write each entry individually.
- No fabricated citations — if unsure, omit.
- Run `scripts/verify_citations.py` to check consistency.

## Citation verification checklist

- [ ] Every major claim has `[N]` citation
- [ ] Every `[N]` in body has matching bibliography entry
- [ ] No duplicate citation numbers
- [ ] No placeholder text in bibliography
- [ ] URLs are complete and plausible
- [ ] Author/publication metadata is present
- [ ] Year matches the claim context
