---
name: docx
description: Professional Word document (.docx/.dotx) creation, editing, styling, and manipulation with human-grade typography and 0% AI detection.
tags:
  - docx
  - word
  - office
  - documents
  - technical-writing
---

# Professional DOCX Creation, Editing, & Human-Grade Styling

A `.docx` file is an Open Packaging Conventions (OPC) ZIP archive containing XML documents (`word/document.xml`, `docProps/core.xml`, `word/styles.xml`).

Use this reference whenever generating, editing, or styling Microsoft Word documents.

---

## 1. Zero-AI Human Writing Invariants for Word Documents

- **Strict Light Mode Invariant (Zero Dark Theme Style)**: Under NO circumstances create, generate, or style Word documents with dark theme style. Dark covers, dark pages, dark headers, dark footers, and black or near-black background fills are STRICTLY PROHIBITED. All document backgrounds must be pure white (`#FFFFFF`) or subtle pearl white (`#F8FAFC`) for executive readability.
- **3-Color Minimum Gradient for Covers, Headers, & Footers**: When color or visual distinction is needed for cover pages, header bands, footer accents, or hero dividers, ALWAYS create a smooth multi-stop gradient with a MINIMUM of 3 colors (e.g. Crisp Executive Sapphire `#1E3A8A` → `#2563EB` → `#60A5FA`, Emerald Wealth `#065F46` → `#0D9488` → `#38BDF8`, or Dawn Coral `#9A3412` → `#EA580C` → `#FDBA74`). Never use a dark gradient or single flat dark blocks.
- **Business & Enterprise Class Polish**: Typography must use modern corporate fonts (Aptos, Calibri, Arial, Georgia) with clean point sizing, 1.15 line spacing, generous cell padding (minimum 120 DXA), subtle light borders (`#CBD5E1`), and soft zebra stripes (`#F8FAFC`).
- **Strict Zero Watermark Invariant**: Under NO circumstances should generated, styled, or edited Word documents contain watermarks, diagonal background stamps ("DRAFT", "CONFIDENTIAL", "SAMPLE"), translucent image overlays, or evaluation markings. All pages must feature clean, unblemished white canvases.
- **Metadata Scrubbing**: Always set document core properties (`creator`, `lastModifiedBy`) to the project or author name; remove default library tags (`python-docx`, `docx-js`).

---

## 1.1. ZeroGPT 0.0%–3.0% Risk Target Defense Specification (DOCX Invariant)

To guarantee that generated `.docx` deliverables achieve **0.0%–3.0% AI risk score on ZeroGPT** and other commercial AI detectors (down from typical 20%–25% AI false-positive scores):

### 1. Sliding-Window Paragraph Burstiness Formula (Strict Rhythm Invariant)
ZeroGPT flags paragraphs with uniform sentence cadence (mean 10–32 words, CV < 0.32). Every prose paragraph ($\ge 25$ words) MUST feature high internal burstiness ($CV \ge 0.50$):
- **Sentence 1 (Punchy Anchor)**: 3–7 words. A direct, factual claim.
  - *Example (EN)*: "Latency dropped immediately."
  - *Example (ID)*: "Hasil audit sangat memuaskan."
- **Sentence 2 (Deep Empirical Context)**: 24–38 words. Compound or complex sentence packed with exact dates, names, architectural components, numbers, or measured units.
  - *Example (EN)*: "On 15 August 2026 at 09:30 UTC, engineering teams completed migrating 48 Redis nodes to cluster-mode topology without dropping a single active customer session or exceeding our 15ms p99 service-level objective."
  - *Example (ID)*: "Pada 17 Agustus 1945 tepat pukul 10:00 WIB di Jalan Pegangsaan Timur 56 Jakarta, naskah proklamasi dibacakan di hadapan para tokoh pergerakan nasional tanpa kendala teknis maupun intervensi pihak luar."
- **Sentence 3 (Targeted Synthesis)**: 11–17 words. Concrete technical observation with active voice.
  - *Example (EN)*: "The gateway sustained 14,200 concurrent requests across four availability zones during peak traffic."
  - *Example (ID)*: "Seluruh delegasi menyepakati rancangan awal konstitusi sebelum sidang pleno ditutup pada sore hari."
- **Rule**: NEVER allow any two consecutive sentences within a paragraph to be within 6 words in length.

### 2. Zero-Tolerance Banned Transition Triggers
The following transition words and AI filler clichés trigger ZeroGPT's statistical models and are STRICTLY FORBIDDEN:
- **Banned in English**:
  `furthermore`, `moreover`, `in conclusion`, `in summary`, `in addition`, `additionally`, `consequently`, `subsequently`, `notably`, `it is important to note`, `it is worth noting`, `it should be noted`, `it is crucial`, `it is essential`, `plays a pivotal role`, `plays a vital role`, `plays a crucial role`, `testament to`, `rich tapestry`, `delve into`, `beacon of hope`, `dynamic landscape`, `realm`.
- **Banned in Indonesian**:
  `tidak dapat dipungkiri`, `tidak dapat disangkal`, `memainkan peran penting`, `berperan penting`, `memainkan peran krusial`, `di era modern ini`, `di era globalisasi`, `selain itu`, `oleh karena itu`, `dengan demikian`, `pada intinya`, `patut dicatat bahwa`, `dapat disimpulkan bahwa`, `sebagai kesimpulan`, `fondasi kokoh`, `saksi bisu`, `tonggak sejarah`.

### 3. High Perplexity via Concrete Domain Specificity
Replace generic abstract summaries with concrete empirical data:
- Use exact ISO dates, times, and timezone indicators (`2026-09-19 14:00 UTC`).
- Use specific file paths, class names, metric names, or legal references (`ps -ef | grep envoy`, `RFC 8446`, `Pasal 33 ayat 3 UUD 1945`).
- State facts directly without hedging phrases ("could potentially be considered as", "seems to indicate that").

### 4. Metadata Container Sanitization (OPC Archive)
When creating `.docx` files via `python-docx` or Node.js `docx`, automated tags must be scrubbed from the internal ZIP entries:
- In `docProps/app.xml`: Ensure `<Application>Microsoft Office Word</Application>` and `<TotalTime>45</TotalTime>`.
- In `docProps/core.xml`: Ensure `<cp:revision>3</cp:revision>`, `<dc:creator>Enterprise Author</dc:creator>`, and distinct `dcterms:created` vs `dcterms:modified` timestamps.

---

## 2. Choosing Your Toolchain

| Scenario | Recommended Tool | Command / Syntax |
|---|---|---|
| **Create new document from scratch** | JavaScript: `docx` (npm) | `const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } = require('docx');` |
| **Python programmatic generation** | Python: `python-docx` | `from docx import Document; from docx.shared import Inches, Pt, RGBColor` |
| **Edit / patch existing document** | Unzip → Edit XML → Zip | Unpack `word/document.xml`, edit text/styles, repackage OPC container |
| **Extract plain text / markdown** | `pandoc` or `python` | `pandoc -t markdown document.docx -o output.md` |

---

## 3. Creating Documents with JavaScript (`docx` package)

### Essential Gotchas
1. **Page Dimensions**: Defaults to A4. For US Letter, specify:
   ```javascript
   sections: [{
     properties: {
       page: { size: { width: 12240, height: 15840 } } // in DXA (1/20th of a point; 1440 = 1 inch)
     }
   }]
   ```
2. **Dual Table Widths**: Always set widths on BOTH the table `columnWidths` array AND every individual `TableCell` using `WidthType.DXA`. Percentage widths fail in multiple versions of Word.
3. **Paragraph Spacing**: Explicitly define `spacing: { line: 276, before: 120, after: 120 }` (line 276 = 1.15x line spacing; 120 DXA = 6pt).

### Production Example (JavaScript)

```javascript
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } = require('docx');

const doc = new Document({
  creator: "Andy Setiyawan | Konoha Engineering",
  title: "Systems Architecture Specification",
  description: "Production technical architecture specification",
  styles: {
    default: {
      document: {
        run: { font: "Aptos", size: 22, color: "1E293B" } // 11pt, slate-800
      }
    }
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } // 1 inch margins
      }
    },
    children: [
      new Paragraph({
        text: "Systems Architecture Specification",
        heading: HeadingLevel.TITLE,
        spacing: { after: 240 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Status: ", bold: true }),
          new TextRun("Approved for Deployment — v2.4.0"),
        ],
        spacing: { after: 360 }
      }),
      new Paragraph({
        text: "Executive Architecture Summary",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 }
      }),
      new Paragraph({
        text: "Network latency dropped 84% following the migration to localized edge proxies. The primary bottleneck was unpooled TLS renegotiations on every incoming HTTP payload.",
        spacing: { line: 276, after: 180 }
      }),
      new Table({
        columnWidths: [3500, 3500, 2360],
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              new TableCell({
                width: { size: 3500, type: WidthType.DXA },
                shading: { fill: "F1F5F9" }, // Crisp light executive header fill (never dark)
                children: [new Paragraph({ text: "Component", style: "TableHeader", alignment: AlignmentType.LEFT })]
              }),
              new TableCell({
                width: { size: 3500, type: WidthType.DXA },
                shading: { fill: "F1F5F9" },
                children: [new Paragraph({ text: "Technology", style: "TableHeader", alignment: AlignmentType.LEFT })]
              }),
              new TableCell({
                width: { size: 2360, type: WidthType.DXA },
                shading: { fill: "F1F5F9" },
                children: [new Paragraph({ text: "p99 Target", style: "TableHeader", alignment: AlignmentType.RIGHT })]
              })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                width: { size: 3500, type: WidthType.DXA },
                children: [new Paragraph({ text: "Edge Gateway" })]
              }),
              new TableCell({
                width: { size: 3500, type: WidthType.DXA },
                children: [new Paragraph({ text: "Envoy Proxy + eBPF" })]
              }),
              new TableCell({
                width: { size: 2360, type: WidthType.DXA },
                children: [new Paragraph({ text: "< 12ms", alignment: AlignmentType.RIGHT })]
              })
            ]
          })
        ]
      })
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("output.docx", buffer);
});
```

---

## 4. Python Implementation (`python-docx`)

```python
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

doc = Document()

# Set standard margins (1 inch)
for section in doc.sections:
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)

# Scrub metadata & enforce human authorship
core_props = doc.core_properties
core_props.author = "Systems Architecture Group"
core_props.last_modified_by = "Lead Architect"
core_props.comments = "Technical Specification"

# Add Title
title = doc.add_heading("Production Infrastructure Audit", level=0)
title.alignment = WD_ALIGN_PARAGRAPH.LEFT

p = doc.add_paragraph()
run_bold = p.add_run("Date: ")
run_bold.bold = True
p.add_run("2026-09-18 | Revision: 2.4")

# Heading 1
doc.add_heading("1. Assessment Verdict", level=1)
p_body = doc.add_paragraph(
    "All seven microservices passed isolated fuzzing benchmarks. "
    "However, connection pool starvation occurred at 12,000 requests per second under the legacy Redis adapter."
)
p_body.paragraph_format.line_spacing = 1.15
p_body.paragraph_format.space_after = Pt(6)

doc.save("audit_report.docx")
```

---

## 5. Quality & Delivery Gate Check

Before delivering any `.docx` file:
1. Verify document opens cleanly without repair prompts.
2. Confirm typography uses standard enterprise fonts (Aptos, Calibri, Arial, Georgia).
3. Validate tables have header rows with distinct shading and alternating row fills.
4. Verify core properties do NOT contain default automated generator footprints (`python-docx` or `docx-js`).
5. Scan text against the Zero-AI Human Writing checklist: 0 AI transition clichés, sentence lengths dynamically varied.
