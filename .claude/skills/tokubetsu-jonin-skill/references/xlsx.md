---
name: xlsx
description: Professional Excel spreadsheet (.xlsx/.xlsm) creation, modeling, formula engineering, and financial styling with human-grade rigor and 0% AI detection.
tags:
  - xlsx
  - excel
  - spreadsheet
  - financial-modeling
  - data-presentation
---

# Professional XLSX Creation, Modeling, & Human-Grade Styling

Spreadsheets are computational data deliverables. A great spreadsheet reads like an executive dashboard or financial model: clean visual structure, zero raw decimals, uppercase formulas, explicit gridlines, and frozen header panes.

Use this reference whenever generating, editing, or auditing Microsoft Excel (.xlsx, .xlsm, .csv) workbooks.

---

## 1. Zero-AI Human Data Presentation Invariants

When creating spreadsheets:
- **Strict Light Mode & Zero Black/Dark Invariant**: Under NO circumstances create, generate, or style Excel workbooks with black, dark gray, or dark blue anywhere (text, fills, lines, backgrounds). Strictly forbidden: `#000000`, `#000`, dark navy, dark slate (`#0F172A`, `#1E293B`, `#1E3A8A`), or dark blocks. All sheet backgrounds must be pure white (`#FFFFFF`) or pearl (`#F8FAFC`), with text strictly in **medium slate `#64748B`**.
- **20 Canonical 4-Base-Color Themes**: When decorative accent styling is applied (such as top accent ribbons on table headers, summary cards, or KPI divider rows), ALWAYS apply a smooth **4-base-color gradient**, randomly selecting ONE of the 20 canonical themes (T01–T20) per document and keeping it consistent throughout:
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
- **Strict Typography Contract**: Excel spreadsheets strictly use **Calibri for both headings and body**, with crisp point sizing (Title: 16pt, Subtitle: 10pt, Headers/Data: 11pt, Totals: 11pt bold).
- **Zero Raw Numbers**: Never leave bare floats (`0.3333333333`). Format currency as `$#,##0` or `$#,##0.00`, percentages as `0.0%` or `0%`, counts as `#,##0`.
- **Formulas Over Hardcoded Values**: If a number is derived from other cells, calculate it via an Excel formula (`=SUM(C4:C12)`, `=C13-D13`), never paste pre-calculated static values into summary rows.
- **Formula Casing**: Always write formula names in ALL CAPS (`SUM`, `AVERAGE`, `IF`, `XLOOKUP`, `INDEX`, `MATCH`). Lowercase formula names (`=sum(...)`) signal hasty robotic generation.
- **Auto-Fit Column Widths**: Every column must be auto-fitted to its longest content plus 3 padding characters so no content is truncated with `###`.
- **Visual Grid & Freeze Panes**: Explicitly enable `ws.views.sheetView[0].showGridLines = True` and freeze header rows (`ws.freeze_panes = 'A5'`).
- **Strict Zero Watermark Invariant**: Under NO circumstances should generated, styled, or edited Excel workbooks contain watermarks, diagonal background stamps, sheet header watermark graphics, or evaluation marks.
- **Metadata Scrubbing**: Set workbook author and properties to the human analyst / organization; remove `openpyxl` / `pandas` application tags.
- **Mandatory Kage Review Gate**: Every generated Excel workbook must undergo Kage review before completion.

---

## 2. Professional Enterprise Color Palettes (Pure Light Mode)

Never use black, dark gray, dark blue, or dark theme fills. Use refined business-class light palettes with text in medium slate `#64748B`:

| Element | Specification & Values |
|---|---|
| **Sheet Background** | Pure White `#FFFFFF` or Pearl `#F8FAFC` |
| **Typography (Headings & Body)** | Medium Slate `#64748B` (Calibri font exclusively) |
| **Header Background** | Executive Slate Tint `#F1F5F9` |
| **Header Accent Ribbon** | 4-base-color gradient ribbon matching the chosen theme (T01–T20) |
| **Zebra Row Shading** | Pearl `#F8FAFC` |
| **Total / Summary Row** | Top thin border `#CBD5E1`, double bottom `#64748B`, text in `#64748B` (bold) |
| **Cell Borders** | Subtle light slate `#E2E8F0` / `#CBD5E1` |

---

## 3. Python Implementation (`openpyxl`)

### Complete Executive Financial Model Example

```python
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Q3 Infrastructure ROI"

# Enforce explicit gridlines
ws.views.sheetView[0].showGridLines = True

# Styling definitions (Pure Light Executive Class - Text strictly in #64748B, Zero dark colors)
font_title = Font(name="Calibri", size=16, bold=True, color="64748B")
font_subtitle = Font(name="Calibri", size=10, italic=True, color="64748B")
font_header = Font(name="Calibri", size=11, bold=True, color="64748B")
font_body = Font(name="Calibri", size=11, color="64748B")
font_total = Font(name="Calibri", size=11, bold=True, color="64748B")

fill_header = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
fill_zebra = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

# 4-Base-Color Gradient Accent Ribbon (Theme T01 example: #8A4FD0, #E8453C, #F08A24, #F7C948)
fill_accent_1 = PatternFill(start_color="8A4FD0", end_color="8A4FD0", fill_type="solid")
fill_accent_2 = PatternFill(start_color="E8453C", end_color="E8453C", fill_type="solid")
fill_accent_3 = PatternFill(start_color="F08A24", end_color="F08A24", fill_type="solid")
fill_accent_4 = PatternFill(start_color="F7C948", end_color="F7C948", fill_type="solid")

align_left = Alignment(horizontal="left", vertical="center")
align_right = Alignment(horizontal="right", vertical="center")
align_center = Alignment(horizontal="center", vertical="center")

border_thin = Side(style="thin", color="E2E8F0")
border_header = Side(style="medium", color="CBD5E1")
border_double = Side(style="double", color="64748B")
border_total = Border(top=border_thin, bottom=border_double)
border_cell = Border(left=border_thin, right=border_thin, top=border_thin, bottom=border_thin)

# Title Block
ws["A1"] = "Q3 Compute Cost Optimization & Migration Audit"
ws["A1"].font = font_title
ws["A2"] = "Prepared by Infrastructure SRE Team | Target Savings: $450,000/yr"
ws["A2"].font = font_subtitle

# 4-Color Gradient Accent Ribbon above table header (Theme T01)
ws.row_dimensions[3].height = 4
ws["A3"].fill = fill_accent_1
ws["B3"].fill = fill_accent_1
ws["C3"].fill = fill_accent_2
ws["D3"].fill = fill_accent_3
ws["E3"].fill = fill_accent_4
ws["F3"].fill = fill_accent_4

# Table Headers (Light Executive Tint)
headers = ["Service Component", "Cluster Tier", "Old Monthly Cost", "New Monthly Cost", "Net Savings", "Delta %"]
for col_idx, header in enumerate(headers, start=1):
    cell = ws.cell(row=4, column=col_idx, value=header)
    cell.font = font_header
    cell.fill = fill_header
    cell.border = Border(top=border_header, bottom=border_header, left=border_thin, right=border_thin)
    cell.alignment = align_left if col_idx <= 2 else align_right

# Data Rows
data = [
    ("Search Index Cluster", "c6i.4xlarge x 8", 14200, 4800),
    ("API Gateway Nodes", "c6i.2xlarge x 12", 9600, 3200),
    ("Vector Memory Cache", "r6i.2xlarge x 6", 8400, 3100),
    ("ETL Batch Workers", "m6i.xlarge Spot", 5200, 1100),
    ("Log Ingestion Pipeline", "t4g.xlarge x 4", 2800, 950),
]

start_row = 5
for i, row in enumerate(data):
    current_row = start_row + i
    c1 = ws.cell(row=current_row, column=1, value=row[0])
    c1.alignment = align_left
    c1.border = border_cell
    c2 = ws.cell(row=current_row, column=2, value=row[1])
    c2.alignment = align_center
    c2.border = border_cell
    
    # Old Cost
    cell_old = ws.cell(row=current_row, column=3, value=row[2])
    cell_old.number_format = '$#,##0'
    cell_old.alignment = align_right
    cell_old.border = border_cell
    
    # New Cost
    cell_new = ws.cell(row=current_row, column=4, value=row[3])
    cell_new.number_format = '$#,##0'
    cell_new.alignment = align_right
    cell_new.border = border_cell
    
    # Savings Formula: =C5-D5
    cell_sav = ws.cell(row=current_row, column=5, value=f"=C{current_row}-D{current_row}")
    cell_sav.number_format = '$#,##0'
    cell_sav.alignment = align_right
    cell_sav.border = border_cell
    
    # Delta Formula: =E5/C5
    cell_pct = ws.cell(row=current_row, column=6, value=f"=E{current_row}/C{current_row}")
    cell_pct.number_format = '0.0%'
    cell_pct.alignment = align_right
    cell_pct.border = border_cell
    
    # Zebra shading
    if i % 2 == 1:
        for c in range(1, 7):
            ws.cell(row=current_row, column=c).fill = fill_zebra

total_row = start_row + len(data)
cell_tot_lbl = ws.cell(row=total_row, column=1, value="Total Infrastructure Portfolio")
cell_tot_lbl.font = font_total
cell_tot_lbl.border = border_total

cell_tot_blank = ws.cell(row=total_row, column=2, value="")
cell_tot_blank.border = border_total

for c in [3, 4, 5]:
    col_letter = get_column_letter(c)
    cell = ws.cell(row=total_row, column=c, value=f"=SUM({col_letter}5:{col_letter}{total_row-1})")
    cell.font = font_total
    cell.number_format = '$#,##0'
    cell.border = border_total

cell_total_pct = ws.cell(row=total_row, column=6, value=f"=E{total_row}/C{total_row}")
cell_total_pct.font = font_total
cell_total_pct.number_format = '0.0%'
cell_total_pct.border = border_total

# Freeze header pane (rows 1-4 frozen)
ws.freeze_panes = "A5"

# Auto-fit columns
for col in ws.columns:
    max_len = 0
    col_letter = get_column_letter(col[0].column)
    for cell in col:
        val_str = str(cell.value or "")
        if len(val_str) > max_len and not str(cell.value).startswith("="):
            max_len = len(val_str)
    ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

# Metadata sanitization
wb.properties.creator = "Andy Setiyawan | SRE Principal"
wb.properties.lastModifiedBy = "Andy Setiyawan"
wb.properties.title = "Q3 Infrastructure ROI"

wb.save("infrastructure_roi.xlsx")
```

---

## 4. Delivery & Verification Checklist

Before shipping any spreadsheet:
1. **Strict Light Mode & Zero Black/Dark Invariant**: Pure light mode strictly enforced. Background is pure white (`#FFFFFF`) or soft pearl (`#F8FAFC`). Zero dark headers, black cells, dark blue, or dark gray anywhere.
2. **Medium Slate `#64748B` Typography**: All text (titles, headers, body, numbers, totals) strictly set in `#64748B`.
3. **Calibri Typography Contract**: Calibri font strictly used for both headings and body text.
4. **4-Base-Color Theme Gradient**: Decorative accent ribbons or KPI highlights strictly use a smooth 4-base-color gradient matching one of the 20 canonical themes (T01–T20) consistently.
5. **Table Header Fills**: Executive light tint (`#F1F5F9`) with bold `#64748B` typography and subtle `#CBD5E1` borders.
6. **Formula Accuracy**: Verify workbook opens in Excel/LibreOffice with 0 formula repair warnings (`#NAME?`, `#VALUE!`, `#REF!`). Formulas use UPPERCASE names (`SUM`, `AVERAGE`).
7. **Formatting**: Verify all numbers have explicit number formatting (`$#,##0`, `0.0%`, `#,##0`).
8. **Freeze Panes & Gridlines**: Confirm freeze panes are set on the header row and gridlines are explicitly turned on (`showGridLines = True`).
9. **Auto-Fit**: Check column widths: no text is clipped and no numbers appear as `###`.
10. **Metadata**: Confirm metadata properties have been sanitized.
11. **Mandatory Kage Review Gate**: Always run Kage review to verify zero-slop compliance, visual hierarchy, and 0% AI detection before delivery.
