# Elite PowerPoint Designer

World-class PowerPoint presentations with the design quality of Apple keynotes, Microsoft product launches, and Google I/O.

## Quick Start

1. **Create your content in markdown** with optional frontmatter:
```markdown
---
style: tech-keynote
accent-color: "#0071E3"
animations: minimal
---

# Your Presentation Title
## Your Subtitle

===

## First Section
Key points here...
```

2. **Analyze content** to get recommendations:
```bash
python scripts/analyze_content.py your-content.md
```

3. **Let Claude Code generate** using the skill:
```
Create a professional presentation from presentation.md using tech-keynote style
```

## Features

✅ **5 World-Class Brand Styles**
- Tech Keynote (Apple/Tesla)
- Corporate Professional (Microsoft/IBM)
- Creative Bold (Google/Airbnb)
- Financial Elite (Goldman Sachs/McKinsey)
- Startup Pitch (Y Combinator)

✅ **Intelligent Template Mapping**
- Auto-detects slide types from markdown
- Maps to 25+ professional templates
- Optimizes layout for content type

✅ **Professional Animation System**
- Brand-appropriate transitions
- Timing guidelines (0.3s-0.8s)
- Emphasis animations for key moments
- Zero unprofessional effects

✅ **Design System Consistency**
- Typography hierarchy (6 levels)
- Color palette enforcement
- Spacing system (80-120px gutters)
- High-contrast accessibility

## Brand Style Guide

### Tech Keynote
Perfect for: Product launches, demos, innovation showcases
```json
{
  "colors": "Black/White/Blue accent",
  "typography": "SF Pro (72-96pt titles)",
  "spacing": "Maximum whitespace",
  "transitions": "Push, Fade (0.6s)",
  "vibe": "Minimalist, premium, bold"
}
```

### Corporate Professional
Perfect for: Business reports, proposals, quarterly reviews
```json
{
  "colors": "Navy/Steel Blue/Gray",
  "typography": "Segoe UI (54-72pt titles)",
  "spacing": "Balanced, grid-based",
  "transitions": "Morph, Fade (0.8s)",
  "vibe": "Trustworthy, data-driven, enterprise"
}
```

### Creative Bold
Perfect for: Marketing, design showcases, creative pitches
```json
{
  "colors": "Bright primaries, gradients",
  "typography": "Product Sans (64-84pt titles)",
  "spacing": "Dynamic, asymmetric",
  "transitions": "Zoom, Reveal (0.5s)",
  "vibe": "Energetic, innovative, playful"
}
```

### Financial Elite
Perfect for: Investor decks, financial reports, board presentations
```json
{
  "colors": "Charcoal/Gold/White",
  "typography": "Garamond serif (60pt titles)",
  "spacing": "Traditional, centered",
  "transitions": "Fade only (0.4s)",
  "vibe": "Sophisticated, authoritative, premium"
}
```

### Startup Pitch
Perfect for: Fundraising, accelerator demos, VC meetings
```json
{
  "colors": "High contrast B/W + accent",
  "typography": "Inter/Roboto (68pt titles)",
  "spacing": "Efficient, metric-focused",
  "transitions": "Quick Push (0.3s)",
  "vibe": "Energetic, data-driven, founder-friendly"
}
```

## Markdown Syntax

### Slide Types
```markdown
# Title → title_slide (Hero treatment)
## Section → chapter_intro (Section divider)
### Key Point → key_message_slide (1-3 points)
* Bullets → bullet_hierarchy_slide
> Quote → quote_slide (Large, impactful)
![image] → full_bleed_image
| table | → data_visualization
=== → Section break
```

### Special Features
```markdown
**Bold text** → Emphasis formatting
*Italic text* → Secondary emphasis
**94%** → Auto-detected as key metric
![hero](img.jpg) → Full-screen image slide
```

## Examples

See `examples/` for complete demonstrations:
- **tech-keynote-example.md** - Product launch style
- **investor-pitch-example.md** - Startup fundraising deck
- **corporate-report-example.md** - Q4 business review

## Requirements

**MCP Server:**
- Office-PowerPoint-MCP-Server

**Python:**
```bash
pip install python-pptx pillow pyyaml
```

## Best Practices

1. **One Idea Per Slide** - If you have multiple points, split them
2. **High-Res Images** - Minimum 1920x1080, prefer 4K
3. **Consistent Style** - Pick one brand style and stick to it
4. **Minimal Animation** - Less is exponentially more
5. **Test Your Deck** - Present it once before the real presentation

## Tips for World-Class Results

**Typography:**
- Use max 2 font families per deck
- Keep titles under 2 lines
- Limit body text to 6 lines max

**Colors:**
- Stick to design system palette
- Maintain 4.5:1 contrast ratio
- Use accent color sparingly (10% of slides)

**Spacing:**
- Maintain 100-120px margins from edges
- Give titles 60-80px breathing room
- Space elements generously

**Animation:**
- Use Fade for 90% of transitions
- Reserve Zoom/Reveal for special moments
- Keep duration 0.4-0.7s
- Never use Ferris Wheel, Curtains, etc.

## Troubleshooting

**"Colors don't match my brand"**
→ Specify exact colors in frontmatter

**"Too many animations"**
→ Set `animations: minimal` in frontmatter

**"Slides too dense"**
→ Follow 6x6 rule: max 6 bullets, 6 words each

**"Wrong style selected"**
→ Explicitly set `style: tech-keynote` in frontmatter

## Advanced Customization

Create custom brand styles in `templates/brands/custom-brand.json`:
```json
{
  "name": "My Brand",
  "colors": {
    "primary": [R, G, B],
    "accent": [R, G, B]
  },
  "typography": {
    "title_font": "Your Font",
    "title_size": 72
  }
}
```

## Support

- Documentation: See `SKILL.md`
- Animation Guide: See `templates/ANIMATION_GUIDE.md`
- Brand Styles: See `templates/brand-styles.json`

## License

MIT - Use freely for your presentations
