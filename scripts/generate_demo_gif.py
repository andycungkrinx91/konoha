#!/usr/bin/env python3
"""Generate a high-definition animated demo GIF showcasing all Konoha features."""

import os
import re
import shutil
from PIL import Image, ImageDraw, ImageFont

WIDTH = 920
HEIGHT = 560
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

font = ImageFont.truetype(FONT_PATH, 14)
font_bold = ImageFont.truetype(BOLD_FONT_PATH, 14)
font_title = ImageFont.truetype(BOLD_FONT_PATH, 13)
font_badge = ImageFont.truetype(BOLD_FONT_PATH, 11)

# Color Palette (Dark GitHub/Dracula-inspired Terminal)
BG_COLOR = (15, 23, 42)         # #0f172a (Deep Slate Blue)
HEADER_BG = (30, 41, 59)        # #1e293b
BORDER_COLOR = (51, 65, 85)     # #334155
TEXT_COLOR = (248, 250, 252)     # #f8fafc (Pure crisp white)
MUTED_COLOR = (148, 163, 184)   # #94a3b8 (Slate gray)
GREEN = (34, 197, 94)           # #22c55e (Emerald)
CYAN = (56, 189, 248)           # #38bdf8 (Sky blue)
AMBER = (251, 191, 36)          # #fbbf24 (Amber)
PURPLE = (192, 132, 252)        # #c084fc (Purple)
RED = (239, 68, 68)             # #ef4444 (Rose red)

DOT_RED = (239, 68, 68)
DOT_YELLOW = (245, 158, 11)
DOT_GREEN = (34, 197, 94)

def parse_line_colors(text):
    """Parse styled tags in text like [green]text[/green], [cyan]text[/cyan], etc."""
    segments = []
    pattern = r'(\[(cyan|green|amber|purple|red|muted|bold)\](.*?)\[\/\2\])'
    last_idx = 0
    for match in re.finditer(pattern, text):
        start, end = match.span()
        if start > last_idx:
            segments.append((text[last_idx:start], TEXT_COLOR, False))
        tag = match.group(2)
        content = match.group(3)
        color = TEXT_COLOR
        is_bold = False
        if tag == 'cyan': color = CYAN
        elif tag == 'green': color = GREEN
        elif tag == 'amber': color = AMBER
        elif tag == 'purple': color = PURPLE
        elif tag == 'red': color = RED
        elif tag == 'muted': color = MUTED_COLOR
        elif tag == 'bold': is_bold = True
        segments.append((content, color, is_bold))
        last_idx = end
    if last_idx < len(text):
        segments.append((text[last_idx:], TEXT_COLOR, False))
    return segments

def draw_terminal_base(title_text="konoha — mcp tools orchestrator"):
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)
    
    # Outer border
    draw.rectangle([0, 0, WIDTH - 1, HEIGHT - 1], outline=BORDER_COLOR, width=2)
    
    # Header bar
    draw.rectangle([1, 1, WIDTH - 2, 38], fill=HEADER_BG)
    draw.line([(1, 38), (WIDTH - 2, 38)], fill=BORDER_COLOR, width=1)
    
    # macOS window traffic lights
    draw.ellipse([16, 13, 28, 25], fill=DOT_RED)
    draw.ellipse([36, 13, 48, 25], fill=DOT_YELLOW)
    draw.ellipse([56, 13, 68, 25], fill=DOT_GREEN)
    
    # Window Title
    bbox = font_title.getbbox(title_text)
    title_w = bbox[2] - bbox[0]
    draw.text(((WIDTH - title_w) // 2, 11), title_text, fill=MUTED_COLOR, font=font_title)
    
    # Status Badge top right
    badge = "v2.0.0 • 6 Clients • SQLite FTS5"
    draw.text((WIDTH - 230, 12), badge, fill=CYAN, font=font_badge)
    
    return img, draw

def render_frame(command, output_lines, feature_badge="FEATURE DEMO"):
    img, draw = draw_terminal_base(f"konoha — {feature_badge}")
    
    y = 52
    x_start = 22
    
    # Feature category badge
    draw.rectangle([x_start, y, x_start + 240, y + 22], fill=(30, 41, 59), outline=CYAN, width=1)
    draw.text((x_start + 8, y + 3), f"⚡ {feature_badge.upper()}", fill=CYAN, font=font_badge)
    y += 32
    
    # Prompt line
    prompt_prefix = "user@ninja:~/konoha$ "
    draw.text((x_start, y), prompt_prefix, fill=GREEN, font=font_bold)
    prefix_w = font_bold.getbbox(prompt_prefix)[2]
    draw.text((x_start + prefix_w, y), command, fill=TEXT_COLOR, font=font_bold)
    y += 24
    
    # Divider
    draw.line([(x_start, y), (WIDTH - 22, y)], fill=(30, 41, 59), width=1)
    y += 10
    
    # Render output lines
    line_h = 19
    max_lines = 21
    
    for line in output_lines[:max_lines]:
        segments = parse_line_colors(line)
        cur_x = x_start
        for content, color, is_bold in segments:
            f = font_bold if is_bold else font
            draw.text((cur_x, y), content, fill=color, font=f)
            bbox = f.getbbox(content)
            cur_x += (bbox[2] - bbox[0])
        y += line_h
        
    return img

scenes = [
    # Scene 1: Konoha Status & 6-Client Matrix
    {
        "badge": "1. System Health & 6-Client MCP Status",
        "cmd": "konoha status",
        "lines": [
            "[green]🍃 Welcome to Konoha — The Ninja Agent Village Management Tool![/green]",
            "[muted]========================================================================[/muted]",
            "[bold]System Health Check:[/bold]",
            "  ✓ Python Environment : [green]python3 (v3.11+)[/green]",
            "  ✓ SQLite FTS5 Index  : [cyan]~/.konoha/skills.db (1.4 MB, 48 records)[/cyan]",
            "  ✓ MCP Server Active  : [green]~/.konoha/server.py (38 registered tools)[/green]",
            "  ✓ Fast Router Proxy  : [purple]127.0.0.1:19999 (in-process)[/purple]",
            "",
            "[bold]Supported AI Coding Clients Auto-Configured:[/bold]",
            "  [green]✓ Antigravity IDE/CLI[/green] : ~/.gemini/config/mcp_config.json + RTK",
            "  [green]✓ Cursor IDE / CLI [/green] : ~/.cursor/mcp.json + subagents + RTK",
            "  [green]✓ Claude Code      [/green] : ~/.claude.json + RTK rules",
            "  [green]✓ OpenCode IDE     [/green] : ~/.config/opencode/opencode.json + RTK",
            "  [green]✓ Command Code     [/green] : ~/.commandcode/mcp.json + RTK",
            "  [green]✓ Codex IDE / CLI  [/green] : [cyan]~/.codex/config.toml (TOML)[/cyan] + RTK",
            "",
            "[amber]Status: All 6 client bridges & RTK rules operational (100% OK)[/amber]"
        ]
    },
    # Scene 2: Subagent Skills Registry & Search
    {
        "badge": "2. High-Speed SQLite FTS5 Skill Search",
        "cmd": "konoha skill list",
        "lines": [
            "[bold]Registered Subagent Skills in SQLite FTS5 Index:[/bold]",
            "  • [cyan]sannin-skill[/cyan]          : Router SOP & Sequential 6-Step Pipeline",
            "  • [cyan]jonin-skill[/cyan]           : Elite Frontend Builder (Next.js, Svelte 5, Nuxt, Angular)",
            "  • [cyan]anbu-skill[/cyan]            : Backend Dev, Cyber Defense, K8s, DevOps & CI/CD",
            "  • [cyan]kage-skill[/cyan]            : Architecture Decisions & 90%+ Security Review Gate",
            "  • [cyan]genin-skill[/cyan]           : Read-only Codebase Exploration & Symbol Search",
            "  • [cyan]chunin-skill[/cyan]          : Intel Research, Web Search & Citation Synthesis",
            "  • [cyan]tokubetsu-jonin-skill[/cyan] : Technical Documentation & API Specifications",
            "  • [cyan]konoha[/cyan]                : Maintenance Orchestrator across 6 Clients",
            "",
            "[green]user@ninja:~$[/green] konoha skill search next",
            "  [green]✓[/green] Found 3 matching skill references in [cyan]0.84ms[/cyan]:",
            "    1. [bold]jonin-skill/framework-nextjs16[/bold] (App Router, Tailwind v4, useMounted)",
            "    2. [bold]jonin-skill/taste-skill-dials[/bold] (3D tilt, glassmorphism, animations)",
            "    3. [bold]jonin-skill/mobile-dock-invariant[/bold] (Archetype-adaptive mobile dock)"
        ]
    },
    # Scene 3: Token Savings Telemetry (~83-98% reduction)
    {
        "badge": "3. Token Savings & Context Preservation",
        "cmd": "konoha savings",
        "lines": [
            "[bold]📊 Context Window Token Savings Report[/bold]",
            "[muted]========================================================================[/muted]",
            "  Time Period     Raw Tokens Sent    Konoha MCP Sent    [green]Tokens Saved (%) [/green]",
            "[muted]------------------------------------------------------------------------[/muted]",
            "  Today         :    482,190               38,420       [green] 443,770 (92.0%)[/green]",
            "  Last 7 Days   :  3,210,400              241,100       [green]2,969,300 (92.5%)[/green]",
            "  All Time      : 14,890,500            1,120,000       [green]13,770,500 (92.5%)[/green]",
            "",
            "[bold]Token Reduction Drivers:[/bold]",
            "  • [cyan]SQLite FTS5 On-Demand Search[/cyan] : Replaces massive skill dumps with excerpts",
            "  • [cyan]RTK (Rust Token Killer)[/cyan]     : Compresses noisy shell stdout by up to 90%",
            "  • [cyan]Auto-Compaction (turn >= 2)[/cyan]  : Compacts invariant memory to < 450 tokens",
            "  • [cyan]Bounded File MCP Tools[/cyan]       : Prevents whole-file context window pollution"
        ]
    },
    # Scene 4: Multi-Archetype Project Workspaces
    {
        "badge": "4. Multi-Archetype Website Builder Engine",
        "cmd": "konoha project list",
        "lines": [
            "[bold]Detected Project Workspaces & Architectural Invariants:[/bold]",
            "",
            "  [bold]Workspace:[/bold] [cyan]/home/andycungkrinx/experiment/portofolio/data/konoha[/cyan]",
            "  • [bold]Framework[/bold]       : Next.js 16 (App Router + React 19)",
            "  • [bold]Styling[/bold]         : Tailwind CSS v4 + Lucide Icons",
            "  • [bold]Package Manager[/bold] : [green]pnpm (Strict Exclusive Policy)[/green]",
            "",
            "[bold]Enforced Default Konoha Design Invariants:[/bold]",
            "  [green]✓[/green] Far-Left Brand Logo (0 Mobile Header Hamburger Toggle)",
            "  [green]✓[/green] Floating Bottom-Left 10-Theme FAB Modal Switcher",
            "  [green]✓[/green] Archetype-Adaptive Fixed Bottom Mobile Dock (`pb-safe`)",
            "  [green]✓[/green] 4-Slide 5000ms Autoplay Hero Banner Carousel",
            "  [green]✓[/green] Fixed Left Sidebar (`w-64`) on Desktop for Admin/Infra Archetypes",
            "  [green]✓[/green] Strict SSR Hydration Safety (`useMounted()` / `onMount` guards)"
        ]
    },
    # Scene 5: Cross-Client Environment Doctor & Auto-Repair
    {
        "badge": "5. Diagnostic Self-Healing (konoha doctor)",
        "cmd": "konoha doctor",
        "lines": [
            "[bold]🩺 Konoha Cross-Client Diagnostics & Auto-Repair[/bold]",
            "[muted]========================================================================[/muted]",
            "  [green]✓[/green] 1. Node.js & Python Environment       : [green]PASS[/green] (Node v20+, Python 3.11)",
            "  [green]✓[/green] 2. SQLite FTS5 Database Schema        : [green]PASS[/green] (FTS5 virtual tables OK)",
            "  [green]✓[/green] 3. RTK Force-First Binary Detection   : [green]PASS[/green] (~/.cargo/bin/rtk)",
            "  [green]✓[/green] 4. Antigravity IDE/CLI Configuration  : [green]PASS[/green] (MCP + Prompt Hooks)",
            "  [green]✓[/green] 5. Cursor IDE Integration             : [green]PASS[/green] (~/.cursor/mcp.json + RTK)",
            "  [green]✓[/green] 6. Claude Code Integration            : [green]PASS[/green] (~/.claude.json + RTK)",
            "  [green]✓[/green] 7. OpenCode IDE Integration           : [green]PASS[/green] (~/.config/opencode/ + RTK)",
            "  [green]✓[/green] 8. Command Code Integration           : [green]PASS[/green] (~/.commandcode/ + RTK)",
            "  [green]✓[/green] 9. Codex CLI / IDE Integration        : [green]PASS[/green] (~/.codex/config.toml + RTK)",
            "",
            "[green]✨ Diagnostic result: All 9 diagnostic checkpoints passed with 0 errors![/green]"
        ]
    },
    # Scene 6: Automated Test Suite & Kage Delivery Gate
    {
        "badge": "6. Automated Test Suite (52/52 Passing)",
        "cmd": "konoha test",
        "lines": [
            "[bold]🧪 Running Complete Cross-Client Regression Suite...[/bold]",
            "  [green][PASS][/green] test_agent_attribution.py          (8/8 subagents resolved)",
            "  [green][PASS][/green] test_codex_manager.js              (TOML MCP parser & serializer)",
            "  [green][PASS][/green] test_cross_client_contract.js      (6 clients validated)",
            "  [green][PASS][/green] test_rtk_cross_client.py           (Force-first RTK deployment)",
            "  [green][PASS][/green] test_docs_currency.py              (Documentation 100% in sync)",
            "  [green][PASS][/green] test_documentation_diagrams.py     (Draw.io XML canonical parity)",
            "  [green][PASS][/green] test_structured_delegation.py      (Inline MCP subagent execution)",
            "  [green][PASS][/green] test_taste_skill_jonin.py          (Taste-Skill dials validation)",
            "",
            "[bold]Test Summary:[/bold] [green]52 passed, 0 failed (100% success rate)[/green]",
            "",
            "┌────────────────────────────────────────────────────────────┐",
            "│   [green]KAGE REVIEWER CONFIDENCE GATE: DELIVERY APPROVED (100%)[/green]  │",
            "└────────────────────────────────────────────────────────────┘"
        ]
    }
]

print("Generating demo frames...")
frames = []

for scene_idx, scene in enumerate(scenes):
    print(f"  Rendering Scene {scene_idx + 1}: {scene['badge']}")
    # Typing effect: frame 1 (command typing), frame 2 (full command), frame 3 (full result)
    cmd = scene["cmd"]
    
    # 1. Partial command typing
    half_cmd = cmd[:len(cmd)//2]
    f1 = render_frame(half_cmd + "█", [], scene["badge"])
    frames.append((f1, 200))
    
    # 2. Full command
    f2 = render_frame(cmd + "█", [], scene["badge"])
    frames.append((f2, 300))
    
    # 3. Progressive output display
    total_lines = len(scene["lines"])
    if total_lines > 6:
        f3 = render_frame(cmd, scene["lines"][:total_lines//2], scene["badge"])
        frames.append((f3, 400))
        
    # 4. Final output state (held for 2500ms for comfortable reading)
    f4 = render_frame(cmd, scene["lines"], scene["badge"])
    frames.append((f4, 2800))

# Export animated GIF
gif_images = [f[0] for f in frames]
durations = [f[1] for f in frames]

target_paths = [
    "assets/demo.gif"
]

for target in target_paths:
    os.makedirs(os.path.dirname(target), exist_ok=True)
    gif_images[0].save(
        target,
        save_all=True,
        append_images=gif_images[1:],
        optimize=True,
        duration=durations,
        loop=0
    )
    size_kb = os.path.getsize(target) / 1024
    print(f"✓ Saved {target} ({size_kb:.1f} KB, {len(frames)} frames)")

print("Demo GIF generation complete!")
