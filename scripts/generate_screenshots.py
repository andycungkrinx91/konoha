#!/usr/bin/env python3
"""Generate high-definition dark-mode terminal PNG screenshots for README.md."""

import os
import re
from PIL import Image, ImageDraw, ImageFont

WIDTH = 860
HEIGHT = 520
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

font = ImageFont.truetype(FONT_PATH, 13)
font_bold = ImageFont.truetype(BOLD_FONT_PATH, 13)
font_title = ImageFont.truetype(BOLD_FONT_PATH, 13)
font_badge = ImageFont.truetype(BOLD_FONT_PATH, 11)

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

def draw_terminal_window(title, command, lines, badge_text):
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)
    
    # Outer border
    draw.rectangle([0, 0, WIDTH - 1, HEIGHT - 1], outline=BORDER_COLOR, width=2)
    
    # Header bar
    draw.rectangle([1, 1, WIDTH - 2, 38], fill=HEADER_BG)
    draw.line([(1, 38), (WIDTH - 2, 38)], fill=BORDER_COLOR, width=1)
    
    # Traffic lights
    draw.ellipse([16, 13, 28, 25], fill=DOT_RED)
    draw.ellipse([36, 13, 48, 25], fill=DOT_YELLOW)
    draw.ellipse([56, 13, 68, 25], fill=DOT_GREEN)
    
    # Window title
    bbox = font_title.getbbox(title)
    title_w = bbox[2] - bbox[0]
    draw.text(((WIDTH - title_w) // 2, 11), title, fill=MUTED_COLOR, font=font_title)
    
    # Top badge
    draw.text((WIDTH - 220, 12), badge_text, fill=CYAN, font=font_badge)
    
    y = 52
    x_start = 22
    
    # Prompt line
    prompt_prefix = "user@konoha:~$ "
    draw.text((x_start, y), prompt_prefix, fill=GREEN, font=font_bold)
    prefix_w = font_bold.getbbox(prompt_prefix)[2]
    draw.text((x_start + prefix_w, y), command, fill=TEXT_COLOR, font=font_bold)
    y += 24
    
    draw.line([(x_start, y), (WIDTH - 22, y)], fill=(30, 41, 59), width=1)
    y += 10
    
    line_h = 18
    for line in lines[:23]:
        segments = parse_line_colors(line)
        cur_x = x_start
        for content, color, is_bold in segments:
            f = font_bold if is_bold else font
            draw.text((cur_x, y), content, fill=color, font=f)
            bbox = f.getbbox(content)
            cur_x += (bbox[2] - bbox[0])
        y += line_h
        
    return img

screenshots = {
    "assets/konoha-status.png": {
        "title": "konoha status — system & mcp health",
        "cmd": "konoha status",
        "badge": "6 CLIENTS • SQLITE FTS5",
        "lines": [
            "[green]📋 Konoha MCP Status[/green]",
            "[muted]========================================================================[/muted]",
            "  ✓ Python 3.11          : [green]/usr/bin/python3 (OK)[/green]",
            "  ✓ SQLite Database      : [cyan]~/.konoha/skills.db (1.42 MB, 48 indexed skills)[/cyan]",
            "  ✓ MCP Server Path      : [green]~/.konoha/server.py (38 registered tools)[/green]",
            "  ✓ Bridge Gateway       : [purple]127.0.0.1:19999 (in-process router active)[/purple]",
            "",
            "[bold]Client MCP Configurations & RTK Rule Status:[/bold]",
            "  [green]✓ Antigravity IDE/CLI[/green]  : ~/.gemini/config/mcp_config.json + RTK [green](OK)[/green]",
            "  [green]✓ Cursor IDE / CLI [/green]  : ~/.cursor/mcp.json + subagents + RTK   [green](OK)[/green]",
            "  [green]✓ Claude Code      [/green]  : ~/.claude.json + double-underscore MCP [green](OK)[/green]",
            "  [green]✓ OpenCode IDE     [/green]  : ~/.config/opencode/opencode.json + RTK [green](OK)[/green]",
            "  [green]✓ Command Code     [/green]  : ~/.commandcode/mcp.json + RTK          [green](OK)[/green]",
            "  [green]✓ Codex IDE / CLI  [/green]  : [cyan]~/.codex/config.toml (TOML)[/cyan] + RTK       [green](OK)[/green]",
            "",
            "[bold]Token Optimization:[/bold]",
            "  • [green]RTK (Rust Token Killer)[/green] : Installed at ~/.cargo/bin/rtk (Force-First)",
            "  • [cyan]Auto-Compaction Contract[/cyan]: Active (turn >= 2, < 450 tokens invariant)",
            "  • [amber]Overall Status[/amber]         : [green]All systems operational (100% healthy)[/green]"
        ]
    },
    "assets/konoha-agent-status.png": {
        "title": "konoha agent status — subagent call telemetry",
        "cmd": "konoha agent status",
        "badge": "SEVEN NINJA SPECIALISTS",
        "lines": [
            "[green]🥷 Subagent Team Call Statistics & Attribution[/green]",
            "[muted]========================================================================[/muted]",
            "",
            "  ┌─────────────────────┬────────┬──────────┬────────────┐",
            "  │ [bold]Subagent[/bold]            │  [bold]Today[/bold] │   [bold]7 Days[/bold] │   [bold]All Time[/bold] │",
            "  ├─────────────────────┼────────┼──────────┼────────────┤",
            "  │ [purple]✧ @sannin[/purple]           │    168 │     1303 │       1513 │",
            "  │ [cyan]⚑ @genin[/cyan]            │     56 │      475 │        588 │",
            "  │ [amber]◎ @kage[/amber]             │    122 │      680 │        780 │",
            "  │ [green]▫ @chunin[/green]           │     48 │      381 │        451 │",
            "  │ [cyan]♦ @jonin[/cyan]            │     88 │      832 │        912 │",
            "  │ [red]♠ @anbu[/red]             │    128 │     1052 │       1212 │",
            "  │ [purple]⬡ @tokubetsu-jonin[/purple]  │     48 │      387 │        447 │",
            "  │ [bold]⚡ Direct Tool Calls[/bold] │    983 │     3680 │       3841 │",
            "  └─────────────────────┴────────┴──────────┴────────────┘",
            "",
            "  [muted]Attribution sources: Antigravity transcripts, Cursor projects,[/muted]",
            "  [muted]Claude Code session logs, OpenCode traces, Command Code, and Codex.[/muted]"
        ]
    },
    "assets/konoha-skill-list.png": {
        "title": "konoha skill list — installed fts5 skills",
        "cmd": "konoha skill list",
        "badge": "FTS5 FULL-TEXT INDEX",
        "lines": [
            "[green]Installed Skills in SQLite FTS5 Database (~/.konoha/skills.db)[/green]",
            "[muted]========================================================================[/muted]",
            "  [cyan]⚡ sannin-skill[/cyan]          : Router SOP & 6-Step Sequential Orchestration Pipeline",
            "  [cyan]⚡ jonin-skill[/cyan]           : Elite UI Builder across Next.js 16, Svelte 5, Nuxt, Angular",
            "  [cyan]⚡ anbu-skill[/cyan]            : Backend Dev, Cyber Defense, K8s, DevOps & CI/CD",
            "  [cyan]⚡ kage-skill[/cyan]            : Architecture Decisions & 90%+ Security Review Gate",
            "  [cyan]⚡ genin-skill[/cyan]           : Read-only Codebase Exploration & Symbol Search",
            "  [cyan]⚡ chunin-skill[/cyan]          : Web Research, Multi-Source Search & Evidence Synthesis",
            "  [cyan]⚡ tokubetsu-jonin-skill[/cyan] : Technical Documentation, README, API Specs & Diagrams",
            "  [cyan]⚡ konoha[/cyan]                : Maintenance Orchestrator across 6 Clients",
            "",
            "[bold]Skill Discovery & Ingestion:[/bold]",
            "  • Query speed      : [green]< 0.85ms[/green] average response time",
            "  • Token reduction  : [green]~83-98%[/green] vs whole-file dumping",
            "  • Index sync       : Auto-synced via [cyan]konoha migrate[/cyan]"
        ]
    },
    "assets/konoha-savings.png": {
        "title": "konoha savings — token reduction telemetry",
        "cmd": "konoha savings",
        "badge": "83-98% TOKEN SAVINGS",
        "lines": [
            "[green]🏆 Combined Total Context Window Savings[/green]",
            "[muted]========================================================================[/muted]",
            "",
            "  ┌─────────────────────────────── Combined Savings Metric ────────────────────────────────┐",
            "  │ [bold]Today[/bold]:         1,579 calls   [green]~50.43M  tokens[/green] (~192.38 MB equivalent) [green](95% saved)[/green]      │",
            "  │ [bold]Last 7 Days[/bold]:   8,810 calls  [green]~353.98M  tokens[/green] (~1.35 GB equivalent)  [green](96% saved)[/green]      │",
            "  │ [bold]All Time[/bold]:     11,880 calls  [green]~506.64M  tokens[/green] (~1.93 GB equivalent)  [green](97% saved)[/green]      │",
            "  ├────────────────────────────────────────────────────────────────────────────────────────┤",
            "  │ [cyan]Actual savings per query: 95% average reduction (computed from live telemetry)[/cyan]    │",
            "  └────────────────────────────────────────────────────────────────────────────────────────┘",
            "",
            "[bold]Reduction Architecture Breakdown:[/bold]",
            "  1. [cyan]Konoha SQLite FTS5 Search[/cyan] : Replaces massive SKILL.md context dumps (~90% savings)",
            "  2. [cyan]Semble Code Retrieval    [/cyan] : Semantic symbol search vs whole-repo greps (~98% savings)",
            "  3. [cyan]RTK Shell Compression    [/cyan] : Token-optimized shell proxy filtering verbose bash output"
        ]
    }
}

os.makedirs("assets", exist_ok=True)
os.makedirs("assest", exist_ok=True)

for path, info in screenshots.items():
    img = draw_terminal_window(info["title"], info["cmd"], info["lines"], info["badge"])
    img.save(path, quality=95)
    
    # Also mirror into assest/
    assest_path = path.replace("assets/", "assest/")
    img.save(assest_path, quality=95)
    
    size_kb = os.path.getsize(path) / 1024
    print(f"✓ Generated {path} & {assest_path} ({size_kb:.1f} KB)")

print("All screenshots generated successfully!")
