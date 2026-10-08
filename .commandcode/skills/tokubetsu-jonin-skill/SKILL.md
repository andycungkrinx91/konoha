---
name: tokubetsu-jonin-skill
description: Standard Operating Procedures for technical writing, README creation, API specifications, runbooks, and documentation updates.
tags:
  - tokubetsu-jonin
  - documentation
  - scribe
  - technical-writing
  - readme
---

# Tokubetsu-Jonin: Technical Writing & Scribe

This skill provides the **Standard Operating Procedures (SOP)** for the Tokubetsu-Jonin agent — specialized in writing and maintaining technical documentation.

## Workflow Role

In the Konoha workflow, Tokubetsu-Jonin handles the documentation phase after all execution tasks complete. The agent writes documentation artifacts and validation evidence, then Kage performs the mandatory review gate before Sannin synthesis. Documentation completion alone never authorizes delivery.

> [!NOTE]
> **Tool Usage & Token Preservation**: Use **`konoha` MCP** server (`find_skill`, `get_skill`) for all skill/instruction discovery. Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it burns quota tokens. Always use `konoha` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.

## SOP 1: Reader-First Documentation
1. Identify the target audience and their goals.
2. Lead with the "why" before the "how".
3. Use clear headings, bullet lists, and code examples.
4. Link references to canonical sources.

## SOP 2: API Specification
1. Document endpoints with method, path, params, body, response, and errors.
2. Include authentication and rate-limiting notes.
3. Provide curl/SDK examples for each endpoint.

## SOP 3: Runbook Creation
1. List prerequisites and dependencies.
2. Provide step-by-step procedures with verification checkpoints.
3. Include rollback and incident response notes.

## SOP 4: Professional Word Document (DOCX) Generation & Refinement
1. **Strict Light Mode & Zero Black/Dark Invariant**: Strictly enforce pure light mode. Never use black, dark gray, or dark blue anywhere (text, fills, lines, backgrounds). Only bright to mid-tone colors on pure white (`#FFFFFF`) or pearl (`#F8FAFC`) backgrounds, with text in **medium slate `#64748B`**.
2. **20 Enterprise 4-Base-Color Themes**: Apply a 4-base-color gradient to the cover, header, and footer lines. Randomly pick ONE of the 20 canonical themes (T01–T20) per document and keep it consistent throughout:
   - T01: `linear-gradient(90deg,#8A4FD0,#E8453C,#F08A24,#F7C948)`
   - T02: `linear-gradient(90deg,#17B3A3,#3A8DDE,#8A4FD0,#E85DA0)`
   - T03: `linear-gradient(90deg,#34B38A,#F7C948,#F08A24,#E85DA0)`
   - T04: `linear-gradient(90deg,#3A8DDE,#17B3A3,#6FCF7A,#F7C948)`
   - T05: `linear-gradient(90deg,#8A4FD0,#D6459E,#E8453C,#F5A04A)`
   - T06: `linear-gradient(90deg,#5CC46A,#F7C948,#F08A24,#E8453C)`
   - T07: `linear-gradient(90deg,#4F8DF0,#8A4FD0,#E85DA0,#F5A04A)`
   - T08: `linear-gradient(90deg,#17B3A3,#6FCF7A,#F7C948,#F2705F)`
   - T09: `linear-gradient(90deg,#3AA6C9,#8A4FD0,#E85DA0,#F7C948)`
   - T10: `linear-gradient(90deg,#3A8DDE,#52D1BC,#8BCB4A,#F5A623)`
   - T11: `linear-gradient(90deg,#8A4FD0,#E85DA0,#F2705F,#F7C948)`
   - T12: `linear-gradient(90deg,#17B3A3,#8BCB4A,#F7C948,#E85D75)`
   - T13: `linear-gradient(90deg,#4F8DF0,#D6459E,#E85D75,#F5A04A)`
   - T14: `linear-gradient(90deg,#8A4FD0,#3A8DDE,#17B3A3,#8BCB4A)`
   - T15: `linear-gradient(90deg,#E85DA0,#E8453C,#F08A24,#8BCB4A)`
   - T16: `linear-gradient(90deg,#7C5CE0,#3A8DDE,#52D1BC,#6FCF7A)`
   - T17: `linear-gradient(90deg,#E8453C,#F08A24,#F7C948,#8BCB4A)`
   - T18: `linear-gradient(90deg,#3A8DDE,#8A4FD0,#D6459E,#F2705F)`
   - T19: `linear-gradient(90deg,#17B3A3,#8BCB4A,#F7C948,#F08A24)`
   - T20: `linear-gradient(90deg,#E85DA0,#F08A24,#F7C948,#17B3A3)`
3. **Typography Contract**: Word/reports strictly use **Georgia (headings) + Calibri (body)** with consistent spacing, alignment, and visual hierarchy.
4. **Burstiness ($\sigma/\mu \ge 0.85$) & Primary Archival Citations**: Clean human-written prose (no robotic, filler, or AI-sounding phrasing). Every paragraph juxtaposes punchy assertions with multi-clause analytical sentences, supported by verifiable primary citations and exact metrics.
5. **Executive Table Styling**: Table headers use light executive tint fills (`#F1F5F9`) with medium slate text (`#64748B`), subtle grid borders (`#E2E8F0`), and numeric columns right-aligned.
6. **Exact Physical Page Budget**: For N-page targets, calibrate content (~200–260 words per page with table/callout) and add explicit page breaks (`doc.add_page_break()`) up to page N-1.
7. **Automated Container Scrubbing**: Run `scrub_opc_zip` with `re.IGNORECASE` to purge `python-docx` tags, normalize `docProps/app.xml` to `Microsoft Word for Windows`, and reset `core.xml` attributes.
8. **Mandatory Kage Review Gate**: Always use Kage review in every generated DOCX document before final delivery.

## SOP 5: Executive Presentation (PPTX) Deck Design
1. **Strict Light Mode & Zero Black/Dark Invariant**: 100% pure white (`#FFFFFF`) or soft pearl (`#F8FAFC`) slide canvas on ALL slides. Never use black, dark gray, or dark blue anywhere. Text strictly in medium slate `#64748B`.
2. **4-Base-Color Gradient Theme Accent**: Select ONE of the 20 canonical themes (T01–T20) consistently across title slide, section dividers, and header accent strips.
3. **Typography Contract**: PowerPoint strictly uses **Segoe UI Semibold or Georgia (headings) + Segoe UI or Calibri (body)**.
4. **Visual Hierarchy & Multi-Tier Cards**: 16:9 widescreen layout, 3 rounded rectangle cards per content slide (`#F8FAFC` background, subtle border `#E2E8F0`, 4px theme gradient accent top strip) featuring Header Tag, Punchy Hook, Analytical Body, and Verifiable Quote.
5. **Metadata Scrubbing**: Run `scrub_opc_zip` to remove generator tags (`python-pptx`, `pptxgenjs`) from presentation core properties and slides.
6. **Mandatory Kage Review Gate**: Always use Kage review in every generated PPTX presentation.

## SOP 6: Enterprise Financial & Data Spreadsheet (XLSX) Modeling
1. **Strict Light Mode & Zero Black/Dark Invariant**: Pure white sheet background (`#FFFFFF`). Never use black, dark gray, or dark blue anywhere. Text strictly in medium slate `#64748B`.
2. **4-Base-Color Theme Top Accent Ribbon**: Decorative ribbon (row 3, height 4) featuring colors from the chosen theme (T01–T20) above the table header.
3. **Typography Contract**: Excel strictly uses **Calibri (headings and body)**.
4. **Table Headers & Cell Styling**: Light executive fill (`#F1F5F9` or `#ECFDF5`) with medium slate text (`#64748B`), thin cell borders (`#E2E8F0`), alternating pearl row fills (`#F8FAFC`).
5. **Model Rigor**: Zero bare decimals; format currency (`$#,##0`), percentages (`0.0%`), and counts (`#,##0`). UPPERCASE formulas (`SUM`, `AVERAGE`, `COUNTIF`, `XLOOKUP`). Lowercase formulas are strictly rejected.
6. **View Setup**: Freeze panes on header row (`ws.freeze_panes = 'A5'`), explicitly show gridlines (`showGridLines = True`), and auto-fit column widths (+4 padding).
7. **Mandatory Kage Review Gate**: Always use Kage review in every generated XLSX spreadsheet.

## SOP 7: Publication-Grade PDF Generation
1. **Strict Light Mode & Zero Black/Dark Invariant**: Pure white page backgrounds (`#FFFFFF`). Never use black, dark gray, or dark blue anywhere. Text strictly in medium slate `#64748B`.
2. **4-Base-Color Gradient Theme**: Apply the selected canonical theme (T01–T20) across cover, header, and footer lines consistently.
3. **Typography Contract**: PDF/digital strictly uses **Inter (headings and body)**.
4. **CSS Paged Media Isolation**: `@page { size: A4 portrait; margin: 16mm 18mm 16mm 18mm; @top-right { ... } @bottom-right { content: "Halaman " counter(page) " dari " counter(pages); } }`. Wrap every page section in `<div class="page">` with `page-break-after: always; box-sizing: border-box;`.
5. **Executive Callout Boxes**: Light tinted background (`#F8FAFC` or `#F0F9FF`) with a 4-color gradient left border accent.
6. **Metadata Scrubbing & Sanitization**: Purge automated PDF library tags (`ReportLab`, `WeasyPrint`) using `sanitize_pdf` with `pydyf.Dictionary()` (Title, Author, Creator `Adobe InDesign 19.0`, Producer `Acrobat Distiller 24.0`).
7. **Mandatory Kage Review Gate**: Always use Kage review in every generated PDF document.

## SOP 8: Zero-AI Human Voice & Authenticity Standard
1. **Mathematical Burstiness Target ($\sigma/\mu \ge 0.85$)**: Enforce extreme sentence length variance within every single paragraph to defeat sliding-window AI classifiers (preventing the 21.9% detection failure).
2. **Comprehensive Purge of AI Clichés**: Ban all transitional clichés and buzzwords in English and Indonesian (*"membuka jalan bagi"*, *"menjadi panggung bersejarah"*, *"kombinasi dwitunggal"*, *"berlangsung damai dan tertib"*, *"kesepakatan agung"*, *"tapestry"*, *"delve"*, *"leverage"*, *"seamless"*, *"paramount"*).
3. **Primary Archival Citations & Empirical Grounding**: Ground every narrative in verifiable shelfmarks, docket numbers, and exact metrics (`87.4%`, `142ms p99`, `v2.4.1`) rather than high-level encyclopedic summaries.
4. **Automated Metadata Scrubbing**: Scrub all container metadata and generator footprints across all file types (`scrub_opc_zip`, `sanitize_pdf`).
5. **100% Human Authenticity & Zero Watermarks**: Achieve 0.0% AI detection score across all external and internal verification gates.

## Domain Routing

Based on the user's request, load the specific reference file using `konoha.get_skill("tokubetsu-jonin-skill/<reference-name>")` (for internal references) or `konoha.get_skill("<skill-name>")` (for global skills). **Never guess implementation details or read files under .agents/skills/ directly.**

| If the request involves... | Load this reference |
|---|---|
| Microsoft Word documents, reports, proposals, DOCX creation/refinement | `tokubetsu-jonin-skill/docx` |
| PowerPoint presentations, pitch decks, slide decks, PPTX | `tokubetsu-jonin-skill/pptx` |
| World-class presentation design, keynote decks, pitch templates | `tokubetsu-jonin-skill/elite-powerpoint-designer` |
| Excel spreadsheets, financial models, data tables, ROI analysis, XLSX | `tokubetsu-jonin-skill/xlsx` |
| Publication-grade PDF reports, whitepapers, ReportLab, WeasyPrint | `tokubetsu-jonin-skill/pdf` |
| Zero-AI human authenticity, document styling invariants, metadata scrubbing | `tokubetsu-jonin-skill/zero-ai-human-writing` |
| Documentation writing, README creation, technical guides, code documentation | `tokubetsu-jonin-skill/documentation-writer` |
| Complete documentation architecture, API references, runbooks, documentation best practices | `documentation` |
| Postmortems, incident reports, root cause analysis (RCA), project retrospectives | `tokubetsu-jonin-skill/postmortem-writer` |
| Content writer, technical articles, tutorials, engineering blogs, case studies, whitepapers | `tokubetsu-jonin-skill/technical-article-writer` |
| Final response shaping, ADHD-friendly concise output, action-first answers | `i-have-adhd` |
