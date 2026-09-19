# Research Methodology

> Load when: conducting deep technical research, multi-source analysis, claim verification, or report planning.

## Research pipeline

| Phase | Activity | Modes |
|-------|----------|-------|
| 1. SCOPE | Define boundaries, success criteria, assumptions | All |
| 2. PLAN | Search strategy, source types, quality gates | Standard+ |
| 3. RETRIEVE | Parallel search, source collection, credibility scoring | All |
| 4. TRIANGULATE | Cross-reference 3+ sources per major claim | Standard+ |
| 4.5. REFINE OUTLINE | Adapt structure based on evidence discovered | Standard+ |
| 5. SYNTHESIZE | Identify patterns, generate insights beyond sources | Standard+ |
| 6. CRITIQUE | Red-team: what's missing, wrong, biased? | Deep+ |
| 7. REFINE | Fill gaps, strengthen weak areas | Deep+ |
| 8. PACKAGE | Generate report using template | All |

## Mode selection

| Mode | Phases | Time | Sources | Use when |
|------|--------|------|---------|----------|
| Quick | 1,3,8 | 2-5 min | 10+ | Exploration, broad overview |
| Standard | 1-5,8 | 5-10 min | 15-30 | Most research (default) |
| Deep | 1-8 | 10-20 min | 25+ | Important decisions |
| UltraDeep | 1-8+ | 20-45 min | 30+ | Critical analysis, max rigor |

Default to **standard** mode. Proceed autonomously — do not ask for approval.

## Search strategy

Decompose the question into 5-10 independent search angles:
1. Core topic (semantic search)
2. Technical details (keyword search)
3. Recent developments (date-filtered, 2024-2025)
4. Academic sources (arxiv, scholar)
5. Alternative perspectives / criticism
6. Statistical / quantitative data
7. Industry analysis
8. Limitations and failure modes

Execute all searches in parallel — never sequentially.

## Source quality

Track each source with:
- Credibility score (0-100 via `scripts/source_evaluator.py`)
- Source type (academic, industry, news, docs)
- Recency (publication date)
- Potential bias

Requirements:
- Minimum 3 source types per research.
- 3+ independent sources per major claim.
- Flag low-credibility sources (<40) for additional verification.
- Prioritize high-credibility sources (>80) for core claims.

## Anti-hallucination rules

- Every factual claim MUST cite a specific source `[N]`.
- Distinguish FACTS (from sources) from SYNTHESIS (your analysis).
- Use "According to [1]..." for source-grounded statements.
- Mark inferences as "This suggests..." not "Research shows..."
- If unsure whether source says X, do NOT fabricate citation.
- Say "No sources found for X" rather than inventing references.

## Writing standards

- **Narrative-driven**: flowing prose, not bullet lists.
- **Precision**: specific data (23%, n=1,847, $2.4B) not vague claims.
- **Economy**: no fluff, every word carries intention.
- **Directness**: state findings clearly without embellishment.
- **Citation density**: major claims cited in the same sentence.
- Bullets only for distinct lists (names, steps) — default to prose.

## Verification

After generating a report, run:

```bash
python scripts/validate_report.py --report [path]
python scripts/verify_citations.py --report [path]
```

If validation fails after 2 attempts, stop and report issues.

## Stop rules

- <5 sources after exhaustive search → report limitation, request direction.
- 2 validation failures on same error → pause, report, ask user.
- User changes scope → confirm new direction.
