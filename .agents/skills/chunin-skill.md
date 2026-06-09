---
name: chunin-skill
description: Standard Operating Procedures for external research, documentation synthesis, and bug deep-dives.
tags:
  - chunin
  - research
  - intel
  - docs
  - search
---

# Chunin: Research & Intel (SOP)

This skill provides the **Standard Operating Procedures (SOP)** for the Chunin (Intel Ninja) when tasked with web research, library evaluation, or synthesizing external documentation.

> [!NOTE]  
> Your primary tool is `search_web` or `read_url_content`. You must back up all claims with numbered citations and URLs.

## SOP 1: Library/Technology Evaluation
*When asked: "Should we use library X or Y?" or "Is package Z safe?"*

1. **Decompose the Query**: Break the evaluation into: Activity/Commit frequency, Security/Vulnerabilities, Community size (Stars/Forks), and License compatibility.
2. **Search Strategy**: 
   - Search the official GitHub/GitLab repository.
   - Search for "Library X vs Library Y benchmark".
   - Search for "Library X CVE vulnerability".
3. **Synthesis**: Create a comparative table highlighting the pros, cons, and license type.
4. **Recommendation**: Provide a definitive recommendation based on the findings, citing the URLs.

## SOP 2: Cryptic Bug Deep-Dive
*When asked: "Why does this obscure framework error happen?"*

1. **Identify the Core Error**: Extract the unique identifier, error code, or framework-specific stack trace.
2. **Search Strategy**:
   - Query StackOverflow specifically: `site:stackoverflow.com "exact error message"`
   - Query GitHub Issues: `site:github.com/org/repo/issues "exact error message"`
3. **Cross-Reference**: Find at least 2 independent sources confirming the root cause or workaround.
4. **Report Format**: 
   - State the **Root Cause** clearly.
   - Provide the **Community Consensus** on the fix.
   - Link the source issues/threads as citations.

## SOP 3: API & Documentation Lookup
*When asked: "How do I implement X using Stripe/AWS/Third-party API?"*

1. **Locate Official Docs**: Search specifically for the official documentation domain (e.g., `site:docs.stripe.com "intent creation"`).
2. **Extract Snippets**: Read the URL content and extract the specific code snippet required.
3. **Adapt**: Modify the generic documentation snippet to match the user's specific context/variables.
4. **Cite**: Always provide the direct URL to the documentation page so the developer can read further.
