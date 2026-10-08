---
name: pptx
description: Executive presentation and PowerPoint (.pptx/.potx) creation, design, and slide engineering with human-grade aesthetics and 0% AI detection.
tags:
  - pptx
  - powerpoint
  - slides
  - presentation
  - keynote
  - pitch-deck
---

# Executive PPTX Creation, Slide Engineering, & Human-Grade Design

A presentation is visual communication designed to persuade, inform, and drive executive decisions. AI-generated slide decks are notoriously recognizable: walls of 5 bullet points per slide, generic circular icons, default blue color schemes, and robotic repetitive wording.

Use this reference whenever building, modifying, or styling presentations and slide decks (.pptx, .potx).

---

## 1. Zero-AI Slide Design Invariants

When creating slide presentations:
- **Strict Light Mode & Zero Black/Dark Invariant**: Under NO circumstances generate, style, or refine slides with black, dark gray, or dark blue anywhere (text, fills, lines, backgrounds). Strictly forbidden: `#000000`, `#000`, dark navy, dark slate (`#0F172A`, `#1E293B`, `#1E3A8A`), or dark blocks. All slides must use pure white (`#FFFFFF`) or pearl (`#F8FAFC`), with text strictly in **medium slate `#64748B`**.
- **20 Canonical 4-Base-Color Themes**: When decorative color or visual emphasis is needed for title covers, headers, footers, card accent strips, or divider rules, ALWAYS apply a smooth **4-base-color gradient**, randomly selecting ONE of the 20 canonical themes (T01–T20) per deck and keeping it consistent throughout:
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
- **Strict Typography Contract**: PowerPoint strictly uses **Segoe UI Semibold or Georgia (headings) + Segoe UI or Calibri (body)** with consistent spacing, alignment, and visual hierarchy.
- **The "Rule of One"**: Exactly 1 central thesis or key takeaway per slide.
- **Strict Ban on AI Bullet Walls**: Never write slides with 4–6 generic bullet points of identical sentence length.
  - *Bad (AI)*: 5 bullets each starting with "Ensures that...", "Facilitates...", "Helps to optimize..."
  - *Good (Human)*: Bold metric card + 1 actionable sentence + visual architecture schematic or supporting data table.
- **Stat Callouts as Visuals**: When presenting performance, savings, or metrics, render the number in massive 44–60pt bold font with a concise 12pt label below it.
- **Asymmetric 2-Column Layouts**: Use 60/40 or 70/30 split layouts (e.g. left side big takeaway and key metrics, right side data table or architectural diagram).
- **16:9 Widescreen Standard**: Always format for 16:9 widescreen (`layout: 'LAYOUT_16x9'` in pptxgenjs; `slide_width = Inches(13.333)`, `slide_height = Inches(7.5)` in python-pptx).
- **Strict Zero Watermark Invariant**: Under NO circumstances should presentation slide decks contain watermarks, translucent stamps, or background evaluation watermarks.
- **Metadata Scrubbing**: Set core presentation properties (`creator`, `lastModifiedBy`, `title`) to the human author or project name; remove `python-pptx` and `pptxgenjs` tags.
- **Mandatory Kage Review Gate**: Always use Kage review on every generated PPTX presentation.

---

## 2. Palette & Typography Rules (Enterprise Light Only)

| Element | Executive Blue Ribbon | Minimalist Slate | Modern Editorial |
|---|---|---|---|
| **Slide Background** | Pure White `#FFFFFF` | Pure White `#FFFFFF` | Pearl Light `#FAFAFA` |
| **Primary Text** | Charcoal Slate `#0F172A` | Deep Graphite `#1E293B` | Deep Ink `#18181B` |
| **3-Color Gradient** | `#1E3A8A` → `#2563EB` → `#60A5FA` | `#0F766E` → `#14B8A6` → `#6EE7B7` | `#9A3412` → `#EA580C` → `#FDBA74` |
| **Accent / Focus Color** | Royal Azure `#2563EB` | Emerald `#059669` | Terracotta Amber `#C2410C` |
| **Secondary / Subtle Text** | Cool Slate `#64748B` | Slate Gray `#64748B` | Warm Gray `#71717A` |
| **Card / Box Fill** | `#F8FAFC` (Border `#E2E8F0`) | `#F8FAFC` (Border `#E2E8F0`) | `#F4F0E8` (Border `#E5DFD3`) |

---

## 3. Node.js Implementation (`pptxgenjs`)

```javascript
const pptxgen = require('pptxgenjs');

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = 'Andy Setiyawan | Architecture Principal';
pres.company = 'Konoha Engineering';
pres.title = 'Production Cloud Migration Q3';

// Slide 1: Title Slide (Executive Light Mode with 3-Color Gradient Accent)
const s1 = pres.addSlide();
s1.background = { color: 'FFFFFF' };

// 3-Color Minimum Gradient Accent Bar (Sapphire -> Azure -> Sky)
s1.addShape(pres.ShapeType.rect, { x: 1.0, y: 1.8, w: 1.2, h: 0.1, fill: { color: '1E3A8A' }, line: { color: '1E3A8A' } });
s1.addShape(pres.ShapeType.rect, { x: 2.2, y: 1.8, w: 1.2, h: 0.1, fill: { color: '2563EB' }, line: { color: '2563EB' } });
s1.addShape(pres.ShapeType.rect, { x: 3.4, y: 1.8, w: 1.2, h: 0.1, fill: { color: '60A5FA' }, line: { color: '60A5FA' } });

s1.addText('Q3 Infrastructure Optimization', {
  x: 1.0, y: 2.2, w: 11.3, h: 1.2,
  fontSize: 44, bold: true, color: '0F172A', fontFace: 'Calibri'
});
s1.addText('Architectural Migration Results & Latency Hardening', {
  x: 1.0, y: 3.4, w: 11.3, h: 0.6,
  fontSize: 20, color: '475569', fontFace: 'Calibri'
});
s1.addText('Prepared by Core Systems Team · September 2026', {
  x: 1.0, y: 6.0, w: 11.3, h: 0.4,
  fontSize: 12, color: '64748B', fontFace: 'Calibri'
});

// Slide 2: Stat Callouts & Key Findings (Asymmetric Layout)
const s2 = pres.addSlide();
s2.background = { color: 'FFFFFF' };

s2.addText('Executive Results: Zero Latency Regression', {
  x: 1.0, y: 0.8, w: 11.3, h: 0.6,
  fontSize: 28, bold: true, color: '0F172A', fontFace: 'Calibri'
});
s2.addText('Full transition of edge gateways to eBPF filters exceeded all reliability KPIs.', {
  x: 1.0, y: 1.4, w: 11.3, h: 0.4,
  fontSize: 14, color: '64748B', fontFace: 'Calibri'
});

// Stat Card 1
s2.addShape(pres.ShapeType.rect, {
  x: 1.0, y: 2.3, w: 3.5, h: 3.2,
  fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 }
});
s2.addText('84%', {
  x: 1.0, y: 2.6, w: 3.5, h: 1.0,
  fontSize: 54, bold: true, color: '4F46E5', align: 'center', fontFace: 'Calibri'
});
s2.addText('P99 Latency Reduction', {
  x: 1.2, y: 3.8, w: 3.1, h: 0.4,
  fontSize: 14, bold: true, color: '0F172A', align: 'center', fontFace: 'Calibri'
});
s2.addText('From 142ms down to 22.8ms across global edge proxies.', {
  x: 1.2, y: 4.3, w: 3.1, h: 0.8,
  fontSize: 11, color: '64748B', align: 'center', fontFace: 'Calibri'
});

// Stat Card 2
s2.addShape(pres.ShapeType.rect, {
  x: 4.9, y: 2.3, w: 3.5, h: 3.2,
  fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 }
});
s2.addText('$420K', {
  x: 4.9, y: 2.6, w: 3.5, h: 1.0,
  fontSize: 54, bold: true, color: '059669', align: 'center', fontFace: 'Calibri'
});
s2.addText('Annualized AWS Savings', {
  x: 5.1, y: 3.8, w: 3.1, h: 0.4,
  fontSize: 14, bold: true, color: '0F172A', align: 'center', fontFace: 'Calibri'
});
s2.addText('Reclaimed compute spend via ARM64 spot instances.', {
  x: 5.1, y: 4.3, w: 3.1, h: 0.8,
  fontSize: 11, color: '64748B', align: 'center', fontFace: 'Calibri'
});

// Supporting Data Table (Right Column) - Light Executive Tint Header
const tableData = [
  [{ text: 'Service Tier', options: { bold: true, fill: 'F1F5F9', color: '0F172A' } },
   { text: 'Target SLA', options: { bold: true, fill: 'F1F5F9', color: '0F172A' } }],
  ['API Gateway', '99.99% (Achieved 100%)'],
  ['Search Worker', '99.95% (Achieved 99.98%)'],
  ['Auth Proxy', '99.99% (Achieved 100%)'],
  ['Vector Store', '99.90% (Achieved 99.95%)']
];
s2.addTable(tableData, {
  x: 8.8, y: 2.3, w: 3.5, h: 3.2,
  fontSize: 11, fontFace: 'Calibri',
  border: { pt: 0.5, color: 'CBD5E1' },
  fill: 'FFFFFF', color: '1E293B'
});

pres.writeFile({ fileName: 'executive_presentation.pptx' });
```

---

## 4. Python Implementation (`python-pptx`)

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

# Metadata scrubbing
prs.core_properties.author = "Andy Setiyawan | SRE Principal"
prs.core_properties.title = "Infrastructure Performance Review"

blank_slide_layout = prs.slide_layouts[6]
slide = prs.slides.add_slide(blank_slide_layout)

# Headline
txBox = slide.shapes.add_textbox(Inches(1.0), Inches(0.8), Inches(11.3), Inches(1.0))
tf = txBox.text_frame
tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "Microservice Migration Strategy"
p.font.size = Pt(32)
p.font.bold = True
p.font.color.rgb = RGBColor(15, 23, 42)

# 3-Color Minimum Gradient Accent Bar (Sapphire -> Azure -> Sky)
bar1 = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1.0), Inches(1.9), Inches(1.2), Inches(0.08))
bar1.fill.solid()
bar1.fill.fore_color.rgb = RGBColor(30, 58, 138) # Sapphire
bar1.line.color.rgb = RGBColor(30, 58, 138)

bar2 = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(2.2), Inches(1.9), Inches(1.2), Inches(0.08))
bar2.fill.solid()
bar2.fill.fore_color.rgb = RGBColor(37, 99, 235) # Azure
bar2.line.color.rgb = RGBColor(37, 99, 235)

bar3 = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(3.4), Inches(1.9), Inches(1.2), Inches(0.08))
bar3.fill.solid()
bar3.fill.fore_color.rgb = RGBColor(96, 165, 250) # Sky
bar3.line.color.rgb = RGBColor(96, 165, 250)

prs.save("presentation_output.pptx")
```

---

## 5. Delivery & Verification Checklist

Before shipping any presentation:
1. **Zero Dark Theme Invariant**: Strictly 100% pure white (`#FFFFFF`) or soft pearl (`#F8FAFC`/`#FAFAFA`) background across ALL slides. Zero dark covers or dark backgrounds.
2. **3-Color Minimum Gradient Invariant**: Any decorative headers, cover accent bars, or slide dividing lines MUST use a minimum 3-color gradient (e.g. Sapphire-to-Azure-to-Sky).
3. **Table Header Fills**: Light executive tints (`#F1F5F9` / `#E2E8F0`) with crisp high-contrast dark text (`#0F172A`). Zero dark table header fills.
4. Verify presentation is strictly 16:9 widescreen format (`13.333` × `7.5` inches).
5. Confirm zero generic bullet-point walls: every slide uses visual cards, stat callouts, or tables.
6. Check font sizing: slide headlines ≥ 24pt, big numbers ≥ 44pt, body text 11–14pt.
7. Verify core properties do not contain automated generator names (`python-pptx` or `pptxgenjs`).
8. Scan copy against the Zero-AI Human Writing rules.
