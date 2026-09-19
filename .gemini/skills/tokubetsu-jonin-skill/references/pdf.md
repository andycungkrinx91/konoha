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
- **Strict Light Mode Invariant (Zero Dark Style)**: PDFs must strictly use pure light mode. Never apply dark theme fills, dark covers, dark header blocks, or black/near-black backgrounds to any page. Page backgrounds must be pure white (`#FFFFFF`) or pearl (`#FAFAFA`).
- **3-Color Minimum Gradient Invariant**: When decorative color is applied to headers, footers, cover accents, or callout ribbons, always use a smooth multi-stop gradient with a minimum of 3 colors (e.g., Sapphire `#1E3A8A` → Azure `#2563EB` → Sky `#60A5FA` or Teal `#0D9488` → Cyan `#06B6D4` → Mint `#6EE7B7`). Monotone dark bars or 2-color harsh transitions are strictly forbidden.
- **Dynamic Two-Pass Pagination**: Every multi-page PDF must include running headers/footers with dynamic page numbering in the exact format: `Page X of Y`. Hardcoded single numbers (`Page 1`) signal naive generation.
- **Professional Font Pairing**: Body copy set in crisp, readable sans-serif (Helvetica, Inter, Arial, Calibri) at 10–10.5pt with 14–15pt leading. Headlines in bold, authoritative hierarchy (H1: 22–26pt, H2: 15–18pt, H3: 12–14pt).
- **Executive Data Tables**: Table headers use light executive fills (`#F1F5F9` or `#E2E8F0`) with dark typography (`#0F172A`). Subtle grid borders (`#E2E8F0`). Alternating rows use pearl shading (`#F8FAFC`).
- **Executive Callout Boxes**: Light tinted fill (`#F0F9FF` or `#F8FAFC`) with a 3-color gradient accent bar along the left edge.
- **Strict Zero Watermark Invariant**: Under NO circumstances should generated, styled, or compiled PDFs include watermarks, diagonal background stamps ("DRAFT", "CONFIDENTIAL", "SAMPLE"), translucent overlay text, or evaluation markings. All pages must be crisp, unblemished, executive-class documents.
- **Metadata Scrubbing**: Author, Title, and Subject fields must be sanitized to human executive attributes; automated generator tags (e.g. `ReportLab PDF Library`, `WeasyPrint`) must be purged.

---

## 2. Professional Color Palettes (Pure Light Mode)

| Element | Executive Slate & Sapphire (Default) | Forest & Mint Finance | Modern Azure Tech |
|---|---|---|---|
| **Page Background** | Pure White `#FFFFFF` | Pure White `#FFFFFF` | Pure White `#FFFFFF` |
| **Body Typography** | Deep Slate `#1E293B` | Deep Slate `#1E293B` | Charcoal `#334155` |
| **Headings** | Midnight Slate `#0F172A` | Deep Spruce `#064E3B` | Deep Navy `#0C4A6E` |
| **3-Color Accent Gradient** | Sapphire `#1E3A8A` → Azure `#2563EB` → Sky `#60A5FA` | Pine `#047857` → Teal `#0D9488` → Mint `#34D399` | Cobalt `#1D4ED8` → Blue `#3B82F6` → Ice `#93C5FD` |
| **Table Header Fill** | Executive Tint `#F1F5F9` | Sage Tint `#ECFDF5` | Azure Tint `#F0F9FF` |
| **Table Header Text** | Bold Slate `#0F172A` | Bold Spruce `#064E3B` | Bold Navy `#0C4A6E` |
| **Callout Background** | Soft Slate `#F8FAFC` | Soft Sage `#F0FDF4` | Soft Sky `#F0F9FF` |

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
            # 3-Color Gradient Running Header Accent Ribbon
            self.setFillColor(colors.HexColor("#1E3A8A"))
            self.rect(54, 11 * inch - 42, 170, 2, fill=True, stroke=False)
            self.setFillColor(colors.HexColor("#2563EB"))
            self.rect(224, 11 * inch - 42, 170, 2, fill=True, stroke=False)
            self.setFillColor(colors.HexColor("#60A5FA"))
            self.rect(394, 11 * inch - 42, 110, 2, fill=True, stroke=False)

        # Footer (all pages)
        # 3-Color Gradient Running Footer Accent Ribbon
        self.setFillColor(colors.HexColor("#1E3A8A"))
        self.rect(54, 46, 170, 1.5, fill=True, stroke=False)
        self.setFillColor(colors.HexColor("#2563EB"))
        self.rect(224, 46, 170, 1.5, fill=True, stroke=False)
        self.setFillColor(colors.HexColor("#60A5FA"))
        self.rect(394, 46, 110, 1.5, fill=True, stroke=False)

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
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=8
    )
    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#475569"),
        spaceAfter=20
    )
    body_style = ParagraphStyle(
        'ExecutiveBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#1E293B"),
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
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor("#0F172A")),
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
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 8pt;
    font-weight: bold;
    color: #0F172A;
  }
}

body {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  color: #1E293B;
  background-color: #FFFFFF;
  line-height: 1.5;
  font-size: 10pt;
}

/* 3-Color Minimum Gradient Accent Ribbon */
.gradient-bar {
  height: 4px;
  background: linear-gradient(90deg, #1E3A8A 0%, #2563EB 50%, #60A5FA 100%);
  margin-bottom: 24px;
  border-radius: 2px;
}

h1 {
  font-size: 22pt;
  color: #0F172A;
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
  color: #0F172A;
  font-weight: 600;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid #CBD5E1;
  font-size: 9.5pt;
}

td {
  padding: 8px 12px;
  border: 1px solid #E2E8F0;
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
1. **Zero Dark Theme Invariant**: Every page must have a pure white (`#FFFFFF`) or pearl (`#FAFAFA`) background. Zero dark covers, headers, or fills.
2. **3-Color Minimum Gradient Invariant**: Running header/footer ribbons, cover accents, or decorative dividers must use at least 3 gradient stops (e.g. Sapphire `#1E3A8A` → Azure `#2563EB` → Sky `#60A5FA`).
3. **Table Header Fills**: Executive light tint (`#F1F5F9` or `#E2E8F0`) with crisp high-contrast dark text (`#0F172A`).
4. **Dynamic Pagination**: Footers must display dynamic `Page X of Y` computed over the actual document length.
5. **No Overflow / Clipping**: Verify tables and text blocks fit within page margins without trailing orphans or text clipping.
6. **Metadata Sanitization**: Check PDF properties with `pdfinfo` or Adobe Reader to ensure generator tags (`ReportLab`, `WeasyPrint`) are replaced with professional author and organization names.
