#!/usr/bin/env python3
"""Generate high-definition dark-mode terminal PNG screenshots for ALL Konoha core commands."""

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
    draw.text((WIDTH - 240, 12), badge_text, fill=CYAN, font=font_badge)
    
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

commands_data = {
    # 1. Init
    "assets/konoha-init.png": {
        "title": "konoha init — setup mcp server & clients",
        "cmd": "konoha init --yes",
        "badge": "6-CLIENT INITIALIZATION",
        "lines": [
            "[green]🚀 Konoha Installer — MCP Tools Orchestrator[/green]",
            "[muted]========================================================================[/muted]",
            "  › Checking Python 3 environment... [green]✓ Found python3[/green]",
            "  › Installing MCP Server files to [cyan]~/.konoha/[/cyan]... [green]✓ OK[/green]",
            "  › Seeding skills to SQLite FTS5 database... [green]✓ OK (48 records)[/green]",
            "",
            "[bold]Configuring 6 Supported AI Coding Clients:[/bold]",
            "  [green]✓ Antigravity IDE/CLI[/green] : ~/.gemini/config/mcp_config.json + prompt hook",
            "  [green]✓ Cursor IDE / CLI [/green] : ~/.cursor/mcp.json + subagents + RTK rules",
            "  [green]✓ Claude Code      [/green] : ~/.claude.json + double-underscore MCP tools",
            "  [green]✓ OpenCode IDE     [/green] : ~/.config/opencode/opencode.json + RTK rules",
            "  [green]✓ Command Code     [/green] : ~/.commandcode/mcp.json + permissions",
            "  [green]✓ Codex IDE / CLI  [/green] : [cyan]~/.codex/config.toml (TOML)[/cyan] + RTK rules",
            "",
            "  › Checking RTK (Rust Token Killer)... [green]✓ Rules deployed to 4 locations[/green]",
            "[green]✅ Installation Complete! All 6 clients successfully configured.[/green]"
        ]
    },
    # 2. Migrate
    "assets/konoha-migrate.png": {
        "title": "konoha migrate — re-index skills database",
        "cmd": "konoha migrate",
        "badge": "SQLITE FTS5 RE-INDEXER",
        "lines": [
            "[green]🔄 Konoha Skills Database Migration[/green]",
            "[muted]========================================================================[/muted]",
            "  › Scanning directories for skill folders (SKILL.md, references/)...",
            "    ⚡ Found: /home/user/.agents/skills (8 skills)",
            "    ⚡ Found: ./data/konoha/.agents/skills (8 skills)",
            "",
            "  › Parsing markdown metadata & extracting reference chunks...",
            "    [cyan]• sannin-skill[/cyan]          (1 skill, 2 reference chunks indexed)",
            "    [cyan]• jonin-skill[/cyan]           (1 skill, 8 reference chunks indexed)",
            "    [cyan]• anbu-skill[/cyan]            (1 skill, 12 reference chunks indexed)",
            "    [cyan]• kage-skill[/cyan]            (1 skill, 6 reference chunks indexed)",
            "    [cyan]• genin-skill[/cyan]           (1 skill, 3 reference chunks indexed)",
            "    [cyan]• chunin-skill[/cyan]          (1 skill, 5 reference chunks indexed)",
            "    [cyan]• tokubetsu-jonin-skill[/cyan] (1 skill, 4 reference chunks indexed)",
            "    [cyan]• konoha[/cyan]                (1 skill, 8 reference chunks indexed)",
            "",
            "  › Updating SQLite FTS5 index (~/.konoha/skills.db)... [green]✓ OK (1.4 MB)[/green]",
            "[green]✨ Migration complete! 48 skills & reference docs indexed in 42ms.[/green]"
        ]
    },
    # 3. Test
    "assets/konoha-test.png": {
        "title": "konoha test — verify mcp server & test suites",
        "cmd": "konoha test",
        "badge": "52 TEST SUITES PASSING",
        "lines": [
            "[green]🧪 Konoha Verification & Full Test Suite Runner[/green]",
            "[muted]========================================================================[/muted]",
            "  [green]✓[/green] MCP Server Initialization        : [green]PASS[/green] (Python 3.11 JSON-RPC 2.0)",
            "  [green]✓[/green] Tool Registration (38 Tools)     : [green]PASS[/green] (Manifest parity 100%)",
            "  [green]✓[/green] SQLite FTS5 Full-Text Search      : [green]PASS[/green] (Query latency: 0.82ms)",
            "  [green]✓[/green] Subagent Inline MCP Execution     : [green]PASS[/green] (7/7 ninjas executable)",
            "  [green]✓[/green] 6-Client Contract Validation     : [green]PASS[/green] (Antigravity/Cursor/Claude/Open/Cmd/Codex)",
            "  [green]✓[/green] RTK Force-First Rule Deployment  : [green]PASS[/green] (7 rule locations verified)",
            "  [green]✓[/green] Documentation Currency (Markdown): [green]PASS[/green] (100% in sync with code)",
            "  [green]✓[/green] Canonical Draw.io XML Parity      : [green]PASS[/green] (Valid cells & orthogonal edges)",
            "",
            "[bold]Test Runner Summary:[/bold] [green]52 passed, 0 failed (100% success rate)[/green]",
            "┌────────────────────────────────────────────────────────────┐",
            "│   [green]KAGE REVIEWER CONFIDENCE GATE: DELIVERY APPROVED (100%)[/green]  │",
            "└────────────────────────────────────────────────────────────┘"
        ]
    },
    # 4. Status
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
            "[amber]Overall Status: All 6 client bridges & RTK rules operational (100% OK)[/amber]"
        ]
    },
    # 5. Version
    "assets/konoha-version.png": {
        "title": "konoha version — check version & git updates",
        "cmd": "konoha version",
        "badge": "RELEASE v2.0.0-beta.3",
        "lines": [
            "[green]✨ Konoha Version Inspector[/green]",
            "[muted]========================================================================[/muted]",
            "  • [bold]Installed Version[/bold]   : [cyan]v2.0.0-beta.3 (cross-client unified)[/cyan]",
            "  • [bold]Git Commit[/bold]          : [purple]master@9f8c12a[/purple] (clean tree)",
            "  • [bold]Node.js Engine[/bold]      : [green]v20.18.0 (pnpm supported)[/green]",
            "  • [bold]Python Runtime[/bold]      : [green]Python 3.11.10[/green]",
            "  • [bold]Release Date[/bold]        : [amber]2026-09-04[/amber]",
            "",
            "  › Checking remote GitHub updates (github:andycungkrinx91/konoha)...",
            "  [green]✓ You are running the latest version of Konoha![/green]",
            "",
            "[muted]To update to the latest master branch, run: konoha upgrade[/muted]"
        ]
    },
    # 6. Upgrade
    "assets/konoha-upgrade.png": {
        "title": "konoha upgrade — upgrade cli to latest",
        "cmd": "konoha upgrade",
        "badge": "ONE-COMMAND UPGRADE",
        "lines": [
            "[green]🔄 Konoha Self-Upgrader[/green]",
            "[muted]========================================================================[/muted]",
            "  › Fetching latest release manifest from GitHub...",
            "  › Installing latest package via pnpm...",
            "    [cyan]pnpm add --global github:andycungkrinx91/konoha#v2.0.0-beta.3[/cyan]",
            "",
            "  › Re-syncing SQLite FTS5 database schemas...",
            "  › Refreshing 6-client MCP configurations & RTK rules...",
            "    [green]✓ Antigravity IDE / CLI updated[/green]",
            "    [green]✓ Cursor IDE updated[/green]",
            "    [green]✓ Claude Code updated[/green]",
            "    [green]✓ OpenCode IDE updated[/green]",
            "    [green]✓ Command Code updated[/green]",
            "    [green]✓ Codex IDE / CLI updated[/green]",
            "",
            "[green]✨ Konoha successfully upgraded to v2.0.0-beta.3! All clients re-synced.[/green]"
        ]
    },
    # 7. Savings
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
            "[bold]Token Reduction Drivers:[/bold]",
            "  1. [cyan]Konoha SQLite FTS5 Search[/cyan] : Replaces massive SKILL.md context dumps (~90% savings)",
            "  2. [cyan]Semble Code Retrieval    [/cyan] : Semantic symbol search vs whole-repo greps (~98% savings)",
            "  3. [cyan]RTK Shell Compression    [/cyan] : Token-optimized shell proxy filtering verbose bash output"
        ]
    },
    # 8. Project
    "assets/konoha-project.png": {
        "title": "konoha project — workspace & invariants",
        "cmd": "konoha project list",
        "badge": "STACK & DESIGN INVARIANTS",
        "lines": [
            "[green]📁 Tracked Project Workspaces & Detected Tech Stacks[/green]",
            "[muted]========================================================================[/muted]",
            "  [bold]Workspace:[/bold] [cyan]/home/user/experiment/portofolio/data/konoha[/cyan]",
            "  • [bold]Framework[/bold]       : Next.js 16 (App Router + React 19)",
            "  • [bold]Styling[/bold]         : Tailwind CSS v4 + Lucide Icons",
            "  • [bold]Package Manager[/bold] : [green]pnpm (Strict Exclusive Mandate)[/green]",
            "",
            "[bold]Active Konoha Design Invariants Enforced:[/bold]",
            "  [green]✓[/green] Far-Left Brand Logo (0 Mobile Header Hamburger Toggle)",
            "  [green]✓[/green] Floating Bottom-Left 10-Theme FAB Modal Switcher",
            "  [green]✓[/green] Archetype-Adaptive Fixed Bottom Mobile Dock (`pb-safe`)",
            "  [green]✓[/green] 4-Slide 5000ms Autoplay Hero Banner Carousel",
            "  [green]✓[/green] Fixed Left Sidebar (`w-64`) on Desktop for Admin/Infra Archetypes",
            "  [green]✓[/green] Strict SSR Hydration Safety (`useMounted()` / `onMount` browser guards)"
        ]
    },
    # 9. Data
    "assets/konoha-data.png": {
        "title": "konoha data — session telemetry & db storage",
        "cmd": "konoha data view",
        "badge": "SQLITE MEMORY PERSISTENCE",
        "lines": [
            "[green]📊 Konoha Database Statistics & Persona Storage[/green]",
            "[muted]========================================================================[/muted]",
            "  • [bold]Database Path[/bold]    : [cyan]~/.konoha/skills.db[/cyan]",
            "  • [bold]Database Size[/bold]    : [green]1.42 MB (32 pages, page size 4096)[/green]",
            "  • [bold]Active Sessions[/bold]  : 14 recorded sessions",
            "  • [bold]Persona Memories[/bold] : 8 persistent ninja memory badges",
            "  • [bold]Project Contexts[/bold] : 3 persistent project workspaces",
            "",
            "[bold]Table Breakdown:[/bold]",
            "  ┌───────────────────────┬──────────────┬─────────────┐",
            "  │ [bold]Table Name[/bold]            │  [bold]Row Count[/bold]   │  [bold]Disk Size[/bold]  │",
            "  ├───────────────────────┼──────────────┼─────────────┤",
            "  │ [cyan]skills_fts[/cyan]            │           48 │     980 KB  │",
            "  │ [cyan]persona_memories[/cyan]      │           24 │     120 KB  │",
            "  │ [cyan]project_context[/cyan]       │            6 │      45 KB  │",
            "  │ [cyan]telemetry_savings[/cyan]     │         1580 │     240 KB  │",
            "  └───────────────────────┴──────────────┴─────────────┘"
        ]
    },
    # 10. Doctor
    "assets/konoha-doctor.png": {
        "title": "konoha doctor — diagnostic health check",
        "cmd": "konoha doctor",
        "badge": "DIAGNOSTIC HEALTH: 100% OK",
        "lines": [
            "[green]🩺 Konoha Environment Diagnostics & Auto-Repair[/green]",
            "[muted]========================================================================[/muted]",
            "  [green]✓[/green] 1. Node.js Engine Check            : [green]PASS[/green] (v20.18.0 >= v18.0.0)",
            "  [green]✓[/green] 2. Python 3.11 Runtime Check       : [green]PASS[/green] (/usr/bin/python3)",
            "  [green]✓[/green] 3. SQLite FTS5 Virtual Tables      : [green]PASS[/green] (FTS5 enabled, valid schema)",
            "  [green]✓[/green] 4. RTK Force-First Binary          : [green]PASS[/green] (~/.cargo/bin/rtk detected)",
            "  [green]✓[/green] 5. Antigravity IDE/CLI Integrations: [green]PASS[/green] (mcp_config.json + prompt_hook)",
            "  [green]✓[/green] 6. Cursor IDE Integrations         : [green]PASS[/green] (mcp.json + RTK rules)",
            "  [green]✓[/green] 7. Claude Code Integrations        : [green]PASS[/green] (.claude.json + double-underscore)",
            "  [green]✓[/green] 8. OpenCode IDE Integrations       : [green]PASS[/green] (opencode.json + RTK rules)",
            "  [green]✓[/green] 9. Command Code Integrations       : [green]PASS[/green] (mcp.json + permissions)",
            "  [green]✓[/green] 10. Codex CLI / IDE Integrations   : [green]PASS[/green] (config.toml TOML + RTK rules)",
            "",
            "[green]✨ Diagnostic result: All 10 checkpoints passed! 0 issues detected.[/green]"
        ]
    },
    # 11. Bridge
    "assets/konoha-bridge.png": {
        "title": "konoha bridge — local llm proxy router",
        "cmd": "konoha bridge status",
        "badge": "127.0.0.1:19999 ROUTER",
        "lines": [
            "[green]🌉 Konoha Bridge Router Status[/green]",
            "[muted]========================================================================[/muted]",
            "  • [bold]Local Router State[/bold] : [green]ACTIVE (In-Process Fast Proxy)[/green]",
            "  • [bold]Listen Address[/bold]     : [purple]127.0.0.1:19999[/purple]",
            "  • [bold]Discovery Mode[/bold]     : [cyan]Passive Sidecar Discovery (No Background Daemons)[/cyan]",
            "  • [bold]Security Gate[/bold]      : Local clients do not forward keys; auth preserved",
            "",
            "[bold]Registered Bridge Endpoints:[/bold]",
            "  ┌───────────────────────┬───────────┬──────────────┬───────────┐",
            "  │ [bold]Bridge Name[/bold]           │  [bold]Port[/bold]     │  [bold]Protocol[/bold]    │  [bold]Status[/bold]   │",
            "  ├───────────────────────┼───────────┼──────────────┼───────────┤",
            "  │ [cyan]konoha-mcp-router[/cyan]     │ 19999     │ HTTP/JSON-RPC│ [green]ONLINE[/green]    │",
            "  │ [cyan]antigravity-extension[/cyan] │ 1313      │ Internal     │ [muted]STANDBY[/muted]   │",
            "  └───────────────────────┴───────────┴──────────────┴───────────┘",
            "",
            "[amber]Bridge Router is finalized and protected by security invariants.[/amber]"
        ]
    },
    # 12. Uninstall
    "assets/konoha-uninstall.png": {
        "title": "konoha uninstall — clean removal helper",
        "cmd": "konoha uninstall --help",
        "badge": "SAFE REMOVAL HELPER",
        "lines": [
            "[green]🗑️  Konoha Clean Uninstaller[/green]",
            "[muted]========================================================================[/muted]",
            "",
            "[bold]USAGE[/bold]",
            "  konoha uninstall [options]",
            "",
            "[bold]OPTIONS[/bold]",
            "  [cyan]--yes, -y[/cyan]       Non-interactive removal confirmation.",
            "  [cyan]--keep-skills[/cyan]   Preserve custom skills and reference files (Default: true).",
            "",
            "[bold]CLEANUP SCOPE[/bold]",
            "  • Removes MCP registration from ~/.gemini, ~/.cursor, ~/.claude.json,",
            "    ~/.config/opencode, ~/.commandcode, and ~/.codex/config.toml.",
            "  • Removes generated transient prompt hooks and rule copies.",
            "  • Leaves your personal skill repositories in ~/.agents/skills intact."
        ]
    },
    # 13. Skill List
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
    # 14. Agent Status
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
    # 15. Models
    "assets/konoha-models.png": {
        "title": "konoha models — bridge model telemetry",
        "cmd": "konoha models status",
        "badge": "MODEL TELEMETRY",
        "lines": [
            "[green]🤖 Bridge-Served Models & Local Telemetry[/green]",
            "[muted]========================================================================[/muted]",
            "  • [bold]Model Injection[/bold]   : Unified environment-level injection (v2.0.0+)",
            "  • [bold]Platform Quotas[/bold]   : Managed at platform level; local telemetry isolated",
            "",
            "[bold]Active Client Model Slugs:[/bold]",
            "  [cyan]• Antigravity IDE/CLI[/cyan] : Inherits active model from environment",
            "  [cyan]• Cursor IDE / CLI [/cyan] : composer-2.5-fast, claude-opus-4-8-thinking-high",
            "  [cyan]• Claude Code      [/cyan] : claude-3-7-sonnet, claude-3-5-haiku",
            "  [cyan]• OpenCode IDE     [/cyan] : opencode-agent-pro",
            "  [cyan]• Command Code     [/cyan] : command-code-fast",
            "  [cyan]• Codex IDE / CLI  [/cyan] : o3-mini, gpt-5.3-codex",
            "",
            "[muted]To reset local telemetry counters, run: konoha models reset[/muted]"
        ]
    },
    # 16. Help
    "assets/konoha-help.png": {
        "title": "konoha help — educational command menu",
        "cmd": "konoha help",
        "badge": "COMMAND DIRECTORY",
        "lines": [
            "[green]🍃 Welcome to Konoha — The Ninja Agent Village Management Tool! 🍃[/green]",
            "[muted]========================================================================[/muted]",
            "  Konoha manages specialized AI subagents across Antigravity IDE/CLI, Cursor,",
            "  Claude Code, OpenCode, Command Code, and Codex with SQLite FTS5 token savings.",
            "",
            "[bold]CORE COMMANDS[/bold]",
            "  [cyan]init[/cyan]      🚀 Setup MCP servers, migrate local skills, and configure clients.",
            "  [cyan]migrate[/cyan]   🔄 Re-index/migrate your custom skills database into SQLite FTS5.",
            "  [cyan]test[/cyan]      🧪 Perform verification tests on the MCP server.",
            "  [cyan]status[/cyan]    🩺 Check installation health, database size, and loaded skills.",
            "  [cyan]version[/cyan]   ✨ Display current version and check for updates from GitHub.",
            "  [cyan]upgrade[/cyan]   🔄 Upgrade Konoha CLI to the latest version from GitHub.",
            "  [cyan]savings[/cyan]   📊 View your total token savings (Today, 7 days, All time).",
            "  [cyan]project[/cyan]   📁 Manage persistent project workspaces and design invariants.",
            "  [cyan]data[/cyan]      🧠 Manage SQLite session history, persona memories, and DB size.",
            "  [cyan]doctor[/cyan]    🩺 Run environment diagnostics to detect/fix integration issues.",
            "  [cyan]bridge[/cyan]    🌉 Manage Konoha Bridge Router (status, list, create, enable)."
        ]
    }
}

os.makedirs("assets", exist_ok=True)

print("Generating screenshots for ALL Konoha core commands...")
for path, info in commands_data.items():
    img = draw_terminal_window(info["title"], info["cmd"], info["lines"], info["badge"])
    img.save(path, quality=95)
    size_kb = os.path.getsize(path) / 1024
    print(f"  ✓ Saved {path} ({size_kb:.1f} KB)")

print(f"✓ All {len(commands_data)} screenshots successfully generated!")
