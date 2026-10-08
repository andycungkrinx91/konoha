---
name: pdf
description: Publication-grade PDF generation, executive document styling, dynamic pagination, and zero-AI styling using ReportLab and WeasyPrint.
tags:
  - pdf
  - document-generation
  - reportlab
  - weasyprint
  - executive-reports
  - publication
---

# Publication-Grade PDF Generation & Executive Styling

PDF is a final-form, non-editable document deliverable. In enterprise and business environments, a professional PDF must resemble high-end technical whitepapers, quarterly earnings reports, or regulatory filings: crisp typography, balanced margins, subtle color accents, dynamic "Page X of Y" pagination, and zero dark theme styling.

Use this reference whenever generating, styling, or auditing standalone PDF documents.

---

## 1. Zero-AI Human Document Invariants

When creating executive PDFs:
- **Strict Light Mode & Zero Black/Dark Invariant**: Under NO circumstances create, generate, or style PDF documents with black, dark gray, or dark blue anywhere (text, fills, lines, backgrounds). Strictly forbidden: `#000000`, `#000`, dark navy, dark slate (`#0F172A`, `#1E293B`, `#1E3A8A`), or dark blocks. All document backgrounds must be pure white (`#FFFFFF`) or pearl (`#FAFAFA`), with text strictly in **medium slate `#64748B`**.
- **20 Canonical 4-Base-Color Themes**: When decorative color is applied to headers, footers, cover accents, or callout ribbons, ALWAYS apply a smooth **4-base-color gradient**, randomly selecting ONE of the 20 canonical themes (T01–T20) per document and keeping it consistent throughout:
  - **T01**: `linear-gradient(90deg,#8A4FD0,#E8453C,#F08A24,#F7C948)`
  - **T02**: `linear-gradient(90deg,#17B3A3,#3A8DDE,#8A4FD0,#E85DA0)`
  - **T03**: `linear-gradient(90deg,#34B38A,#F7C948,#F08A24,#E85DA0)`
  - **T04**: `linear-gradient(90deg,#3A8DDE,#17B3A3,#6FCF7A,#F7C948)`
  - **T05**: `linear-gradient(90deg,#8A4FD0,#D6459E,#E8453C,#F5A04A)`
  - **T06**: `linear-gradient(90deg,#5CC46A,#F7C948,#F08A24,#E8453C)`
  - **T07**: `linear-gradient(90deg,#4F8DF0,#8A4FD0,#E85DA0,#F5A04A)`
  - **T08**: `linear-gradient(90deg,#17B3A3,#6FCF7A,#F7C948,#F2705F)`
  - **T09**: `linear-gradient(90deg,#3AA6C9,#8A4FD0,#E85DA0,#F7C948)`
  - **T10**: `linear-gradient(90deg,#3A8DDE,#52D1BC,#8BCB4A,#F5A623)`
  - **T11**: `linear-gradient(90deg,#8A4FD0,#E85DA0,#F2705F,#F7C948)`
  - **T12**: `linear-gradient(90deg,#17B3A3,#8BCB4A,#F7C948,#E85D75)`
  - **T13**: `linear-gradient(90deg,#4F8DF0,#D6459E,#E85D75,#F5A04A)`
  - **T14**: `linear-gradient(90deg,#8A4FD0,#3A8DDE,#17B3A3,#8BCB4A)`
  - **T15**: `linear-gradient(90deg,#E85DA0,#E8453C,#F08A24,#8BCB4A)`
  - **T16**: `linear-gradient(90deg,#7C5CE0,#3A8DDE,#52D1BC,#6FCF7A)`
  - **T17**: `linear-gradient(90deg,#E8453C,#F08A24,#F7C948,#8BCB4A)`
  - **T18**: `linear-gradient(90deg,#3A8DDE,#8A4FD0,#D6459E,#F2705F)`
  - **T19**: `linear-gradient(90deg,#17B3A3,#8BCB4A,#F7C948,#F08A24)`
  - **T20**: `linear-gradient(90deg,#E85DA0,#F08A24,#F7C948,#17B3A3)`
- **Dynamic Two-Pass Pagination**: Every multi-page PDF must include running headers/footers with dynamic page numbering in the exact format: `Page X of Y`. Hardcoded single numbers (`Page 1`) signal naive generation.
- **Strict Typography Contract**: PDF/digital deliverables strictly use **Inter (headings and body)** (fallback: Helvetica/Arial). Body copy at 10–10.5pt with 14–15pt leading in medium slate `#64748B`. Headlines in bold, authoritative hierarchy (H1: 22–26pt, H2: 15–18pt, H3: 12–14pt) in medium slate `#64748B`.
- **Executive Data Tables**: Table headers use light executive fills (`#F1F5F9`) with `#64748B` typography. Subtle grid borders (`#CBD5E1` / `#E2E8F0`). Alternating rows use pearl shading (`#F8FAFC`).
- **Executive Callout Boxes**: Light tinted fill (`#F8FAFC`) with a 4-color gradient accent bar along the left edge.
- **Strict Zero Watermark Invariant**: Under NO circumstances should generated, styled, or compiled PDFs include watermarks, diagonal background stamps ("DRAFT", "CONFIDENTIAL", "SAMPLE"), translucent overlay text, or evaluation markings. All pages must be crisp, unblemished, executive-class documents.
- **Metadata Scrubbing**: Author, Title, and Subject fields must be sanitized to human executive attributes; automated generator tags (e.g. `ReportLab PDF Library`, `WeasyPrint`) must be purged.
- **Mandatory Kage Review Gate**: Every generated PDF document must undergo Kage review before completion.

---

## 2. Professional Color Palettes (Pure Light Mode)

Never use black, dark gray, dark blue, or dark theme fills. Use refined business-class light palettes with text in medium slate `#64748B`:

| Element | Specification & Values |
|---|---|
| **Page Background** | Pure White `#FFFFFF` or Soft Pearl `#FAFAFA` |
| **Typography (Headings & Body)** | Medium Slate `#64748B` (Inter font exclusively) |
| **4-Base-Color Accent Gradient** | 4-base-color gradient ribbon matching chosen theme (T01–T20) |
| **Table Header Fill** | Executive Light Tint `#F1F5F9` |
| **Table Header Text** | Medium Slate `#64748B` (Bold) |
| **Table Cell Borders** | Subtle Light Slate `#CBD5E1` / `#E2E8F0` |
| **Alternating Rows** | Soft Pearl `#F8FAFC` |
| **Callout Background** | Soft Slate `#F8FAFC` with 4-color left border accent |

---

## 3. Python Implementation (`reportlab`)

The canonical approach uses `reportlab.platypus` with a custom two-pass `NumberedCanvas` to draw exact dynamic headers, footers with `Page X of Y`, and 3-color gradient accent ribbons:

```python
import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    """Two-pass canvas for dynamic running headers and 'Page X of Y' footers."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_header_and_footer(num_pages)
            super().showPage()
        super().save()

    def draw_header_and_footer(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 9)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header (pages > 1)
        if self._pageNumber > 1:
            self.drawString(54, 11 * inch - 36, "Konoha Infrastructure Engineering · Architecture Audit")
            self.drawRightString(8.5 * inch - 54, 11 * inch - 36, "Q3 Production Performance")
            # 4-Base-Color Gradient Running Header Accent Ribbon (Theme T01)
            self.setFillColor(colors.HexColor("#8A4FD0"))
            self.rect(54, 11 * inch - 42, 125, 2, fill=True, stroke=False)
            self.setFillColor(colors.HexColor("#E8453C"))
            self.rect(179, 11 * inch - 42, 125, 2, fill=True, stroke=False)
            self.setFillColor(colors.HexColor("#F08A24"))
            self.rect(304, 11 * inch - 42, 125, 2, fill=True, stroke=False)
            self.setFillColor(colors.HexColor("#F7C948"))
            self.rect(429, 11 * inch - 42, 75, 2, fill=True, stroke=False)

        # Footer (all pages)
        # 4-Base-Color Gradient Running Footer Accent Ribbon (Theme T01)
        self.setFillColor(colors.HexColor("#8A4FD0"))
        self.rect(54, 46, 125, 1.5, fill=True, stroke=False)
        self.setFillColor(colors.HexColor("#E8453C"))
        self.rect(179, 46, 125, 1.5, fill=True, stroke=False)
        self.setFillColor(colors.HexColor("#F08A24"))
        self.rect(304, 46, 125, 1.5, fill=True, stroke=False)
        self.setFillColor(colors.HexColor("#F7C948"))
        self.rect(429, 46, 75, 1.5, fill=True, stroke=False)

        self.drawString(54, 32, "Confidential · Internal Executive Review Only")
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(8.5 * inch - 54, 32, page_str)
        self.restoreState()

def build_executive_pdf(output_path="executive_report.pdf"):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54,
        author="Andy Setiyawan | SRE Principal",
        title="Q3 Infrastructure ROI Audit"
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=30,
        textColor=colors.HexColor("#64748B"),
        spaceAfter=8
    )
    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#64748B"),
        spaceAfter=20
    )
    body_style = ParagraphStyle(
        'ExecutiveBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#64748B"),
        spaceAfter=10
    )

    story = []

    # Title & Metadata
    story.append(Paragraph("Q3 Infrastructure Performance & Modernization", title_style))
    story.append(Paragraph("Executive Engineering Audit · September 2026", subtitle_style))
    story.append(Spacer(1, 10))

    # Executive Summary Paragraph
    summary_text = (
        "During Q3 2026, the core platform completed the architectural transition from legacy "
        "reverse proxies to eBPF edge gateways. System-wide P99 latency dropped by 84%, "
        "while compute infrastructure spend was reduced by $420,000 annually. This document "
        "details service tier performance, resilience verification, and Q4 roadmap initiatives."
    )
    story.append(Paragraph(summary_text, body_style))
    story.append(Spacer(1, 15))

    # Executive Data Table (Pure Light Mode with Executive Tint Header)
    table_data = [
        [Paragraph("<b>Service Cluster</b>", body_style),
         Paragraph("<b>Target SLA</b>", body_style),
         Paragraph("<b>Actual P99</b>", body_style),
         Paragraph("<b>Cost Delta</b>", body_style)],
        [Paragraph("API Gateway Nodes", body_style), Paragraph("99.99%", body_style), Paragraph("14.2 ms", body_style), Paragraph("-$76,800/yr", body_style)],
        [Paragraph("Search Index Cluster", body_style), Paragraph("99.95%", body_style), Paragraph("28.4 ms", body_style), Paragraph("-$112,800/yr", body_style)],
        [Paragraph("Vector Store Workers", body_style), Paragraph("99.90%", body_style), Paragraph("31.0 ms", body_style), Paragraph("-$63,600/yr", body_style)],
        [Paragraph("Auth & Session Proxy", body_style), Paragraph("99.99%", body_style), Paragraph("9.1 ms", body_style), Paragraph("-$54,000/yr", body_style)],
    ]

    t = Table(table_data, colWidths=[150, 110, 110, 134])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor("#64748B")),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]))
    story.append(t)

    doc.build(story, canvasmaker=NumberedCanvas)

if __name__ == "__main__":
    build_executive_pdf()
```

---

## 4. HTML/CSS Implementation (`weasyprint`)

For environments leveraging HTML-to-PDF compilation via `weasyprint`, use strict print CSS rules:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
@page {
  size: letter;
  margin: 20mm 18mm 22mm 18mm;
  background-color: #FFFFFF;
  @top-right {
    content: "Q3 Production Performance Review";
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 8pt;
    color: #64748B;
  }
  @bottom-left {
    content: "Confidential · Internal Executive Review";
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 8pt;
    color: #64748B;
  }
  @bottom-right {
    content: "Page " counter(page) " of " counter(pages);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 8pt;
    font-weight: bold;
    color: #64748B;
  }
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  color: #64748B;
  background-color: #FFFFFF;
  line-height: 1.5;
  font-size: 10pt;
}

/* 4-Base-Color Theme Gradient Accent Ribbon (Theme T01) */
.gradient-bar {
  height: 4px;
  background: linear-gradient(90deg, #8A4FD0 0%, #E8453C 33%, #F08A24 66%, #F7C948 100%);
  margin-bottom: 24px;
  border-radius: 2px;
}

h1 {
  font-size: 22pt;
  color: #64748B;
  margin: 0 0 6px 0;
  font-weight: 700;
}

.subtitle {
  font-size: 11pt;
  color: #64748B;
  margin-bottom: 20px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 16px;
}

th {
  background-color: #F1F5F9;
  color: #64748B;
  font-weight: 600;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid #CBD5E1;
  font-size: 9.5pt;
}

td {
  padding: 8px 12px;
  border: 1px solid #E2E8F0;
  color: #64748B;
  font-size: 9pt;
}

tr:nth-child(even) td {
  background-color: #F8FAFC;
}
</style>
</head>
<body>
  <div class="gradient-bar"></div>
  <h1>Q3 Infrastructure Modernization Audit</h1>
  <div class="subtitle">Platform Reliability & Compute Efficiency Analysis · September 2026</div>
  <p>System-wide latency optimizations achieved an 84% reduction in P99 response times following the deployment of eBPF ingress routers.</p>
</body>
</html>
```

---

## 5. Delivery & Verification Checklist

Before releasing any executive PDF document:
1. **Strict Light Mode & Zero Black/Dark Invariant**: Every page must have a pure white (`#FFFFFF`) or pearl (`#FAFAFA`) background. Zero black, dark gray, or dark blue anywhere (text, fills, lines, backgrounds).
2. **Medium Slate `#64748B` Typography**: All typography strictly in `#64748B`.
3. **Inter Typography Contract**: Inter font strictly used for headings and body.
4. **4-Base-Color Theme Gradient**: Running header/footer ribbons, cover accents, or decorative dividers must use a 4-base-color gradient matching one of the 20 canonical themes (T01–T20) consistently.
5. **Table Header Fills**: Executive light tint (`#F1F5F9`) with medium slate `#64748B` text and subtle `#CBD5E1` borders.
6. **Dynamic Pagination**: Footers must display dynamic `Page X of Y` computed over the actual document length.
7. **No Overflow / Clipping**: Verify tables and text blocks fit within page margins without trailing orphans or text clipping.
8. **Metadata Sanitization**: Check PDF properties with `pdfinfo` or Adobe Reader to ensure generator tags (`ReportLab`, `WeasyPrint`) are replaced with professional author and organization names.
9. **Mandatory Kage Review Gate**: Always run Kage review to verify zero-slop compliance, visual hierarchy, and 0% AI detection before delivery.
