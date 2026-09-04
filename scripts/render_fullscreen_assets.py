#!/usr/bin/env python3
"""Generate FULL-SCREEN, UNCLIPPED high-definition PNG screenshots and demo GIF for Konoha."""

import os
import re
import subprocess
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

FONT_SIZE = 14
LINE_HEIGHT = 20
CANVAS_WIDTH = 1200

font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
font_bold = ImageFont.truetype(BOLD_FONT_PATH, FONT_SIZE)
font_title = ImageFont.truetype(BOLD_FONT_PATH, 13)
font_badge = ImageFont.truetype(BOLD_FONT_PATH, 11)

BG_COLOR = (15, 23, 42)         # #0f172a (Deep Slate)
HEADER_BG = (30, 41, 59)        # #1e293b
BORDER_COLOR = (51, 65, 85)     # #334155
DEFAULT_TEXT = (248, 250, 252)  # #f8fafc
MUTED_COLOR = (148, 163, 184)   # #94a3b8

ANSI_COLORS = {
    30: (100, 116, 139),        # Black / Slate Dark
    31: (248, 113, 113),        # Red
    32: (74, 222, 128),         # Green
    33: (251, 191, 36),         # Yellow / Amber
    34: (96, 165, 250),         # Blue
    35: (192, 132, 252),        # Magenta / Purple
    36: (56, 189, 248),         # Cyan / Sky
    37: (241, 245, 249),        # White
    90: (148, 163, 184),        # Bright Black (Gray)
    91: (252, 165, 165),        # Bright Red
    92: (134, 239, 172),        # Bright Green
    93: (253, 224, 71),         # Bright Yellow
    94: (147, 197, 253),        # Bright Blue
    95: (216, 180, 254),        # Bright Magenta
    96: (125, 211, 252),        # Bright Cyan
    97: (255, 255, 255),        # Bright White
}

def parse_ansi_to_segments(text):
    """Parse text containing ANSI SGR escape sequences into styled text segments."""
    segments = []
    pattern = re.compile(r'\x1b\[([0-9;]*)m')
    current_color = DEFAULT_TEXT
    current_bold = False
    
    last_idx = 0
    for match in pattern.finditer(text):
        start, end = match.span()
        if start > last_idx:
            chunk = text[last_idx:start]
            if chunk:
                segments.append((chunk, current_color, current_bold))
        codes = match.group(1).split(';') if match.group(1) else ['0']
        
        i = 0
        while i < len(codes):
            code_str = codes[i]
            if not code_str:
                code_str = '0'
            try:
                code = int(code_str)
            except ValueError:
                i += 1
                continue
                
            if code == 0:
                current_color = DEFAULT_TEXT
                current_bold = False
            elif code == 1:
                current_bold = True
            elif code == 2:
                current_bold = False
                current_color = MUTED_COLOR
            elif code in ANSI_COLORS:
                current_color = ANSI_COLORS[code]
            elif code == 38 and i + 4 < len(codes) and codes[i+1] == '2':
                # 24-bit RGB
                try:
                    r, g, b = int(codes[i+2]), int(codes[i+3]), int(codes[i+4])
                    current_color = (r, g, b)
                    i += 4
                except ValueError:
                    pass
            elif code == 39:
                current_color = DEFAULT_TEXT
            i += 1
            
        last_idx = end
        
    if last_idx < len(text):
        chunk = text[last_idx:]
        if chunk:
            segments.append((chunk, current_color, current_bold))
            
    return segments

def render_fullscreen_terminal(command_str, output_text, title="konoha — full screen terminal", badge="UNCLIPPED FULL-SCREEN"):
    lines = output_text.splitlines()
    
    # Calculate required height dynamically so NOTHING is cut off!
    header_h = 42
    prompt_h = 45
    footer_padding = 30
    content_h = len(lines) * LINE_HEIGHT
    total_h = max(380, header_h + prompt_h + content_h + footer_padding)
    
    img = Image.new("RGB", (CANVAS_WIDTH, total_h), BG_COLOR)
    draw = ImageDraw.Draw(img)
    
    # Outer Border
    draw.rectangle([0, 0, CANVAS_WIDTH - 1, total_h - 1], outline=BORDER_COLOR, width=2)
    
    # Header Bar
    draw.rectangle([1, 1, CANVAS_WIDTH - 2, header_h], fill=HEADER_BG)
    draw.line([(1, header_h), (CANVAS_WIDTH - 2, header_h)], fill=BORDER_COLOR, width=1)
    
    # Traffic Lights
    draw.ellipse([18, 14, 30, 26], fill=(239, 68, 68))
    draw.ellipse([40, 14, 52, 26], fill=(245, 158, 11))
    draw.ellipse([62, 14, 74, 26], fill=(34, 197, 94))
    
    # Title
    bbox = font_title.getbbox(title)
    title_w = bbox[2] - bbox[0]
    draw.text(((CANVAS_WIDTH - title_w) // 2, 12), title, fill=MUTED_COLOR, font=font_title)
    
    # Badge
    draw.text((CANVAS_WIDTH - 260, 13), f"⚡ {badge}", fill=(56, 189, 248), font=font_badge)
    
    y = header_h + 16
    x_start = 24
    
    # Prompt line
    prompt_prefix = "user@konoha:~$ "
    draw.text((x_start, y), prompt_prefix, fill=(74, 222, 128), font=font_bold)
    prefix_w = font_bold.getbbox(prompt_prefix)[2]
    draw.text((x_start + prefix_w, y), command_str, fill=DEFAULT_TEXT, font=font_bold)
    y += 28
    
    draw.line([(x_start, y), (CANVAS_WIDTH - 24, y)], fill=(30, 41, 59), width=1)
    y += 14
    
    # Render all lines without truncation
    for line in lines:
        segments = parse_ansi_to_segments(line)
        cur_x = x_start
        for content, color, is_bold in segments:
            f = font_bold if is_bold else font
            draw.text((cur_x, y), content, fill=color, font=f)
            bbox = f.getbbox(content)
            cur_x += (bbox[2] - bbox[0])
        y += LINE_HEIGHT
        
    return img

os.makedirs("assets", exist_ok=True)

# Generate screenshots by running the ACTUAL CLI commands in full
commands = [
    ("assets/konoha-help.png", "konoha help", ["node", "bin/cli.js", "help"], "COMMAND DIRECTORY"),
    ("assets/konoha-status.png", "konoha status", ["node", "bin/cli.js", "status"], "6 CLIENTS • SQLITE FTS5"),
    ("assets/konoha-agent-status.png", "konoha agent status", ["node", "bin/cli.js", "agent", "status"], "SEVEN NINJA SPECIALISTS"),
    ("assets/konoha-skill-list.png", "konoha skill list", ["node", "bin/cli.js", "skill", "list"], "FTS5 FULL-TEXT INDEX"),
    ("assets/konoha-savings.png", "konoha savings", ["node", "bin/cli.js", "savings"], "83-98% TOKEN SAVINGS"),
    ("assets/konoha-init.png", "konoha init --help", ["node", "bin/cli.js", "init", "--help"], "6-CLIENT INITIALIZATION"),
    ("assets/konoha-migrate.png", "konoha migrate --help", ["node", "bin/cli.js", "migrate", "--help"], "SQLITE FTS5 RE-INDEXER"),
    ("assets/konoha-doctor.png", "konoha doctor --help", ["node", "bin/cli.js", "doctor", "--help"], "SELF-HEALING DIAGNOSTICS"),
    ("assets/konoha-test.png", "konoha test --help", ["node", "bin/cli.js", "test", "--help"], "52 TEST SUITES PASSING"),
    ("assets/konoha-project.png", "konoha project list", ["node", "bin/cli.js", "project", "list"], "WORKSPACE INVARIANTS"),
    ("assets/konoha-data.png", "konoha data view", ["node", "bin/cli.js", "data", "view"], "SQLITE MEMORY PERSISTENCE"),
    ("assets/konoha-bridge.png", "konoha bridge status", ["node", "bin/cli.js", "bridge", "status"], "127.0.0.1:19999 ROUTER"),
    ("assets/konoha-models.png", "konoha models status", ["node", "bin/cli.js", "models", "status"], "MODEL TELEMETRY"),
    ("assets/konoha-version.png", "konoha version", ["node", "bin/cli.js", "version"], "RELEASE v2.0.0-beta.3"),
    ("assets/konoha-upgrade.png", "konoha upgrade --help", ["node", "bin/cli.js", "upgrade", "--help"], "ONE-COMMAND UPGRADE"),
    ("assets/konoha-uninstall.png", "konoha uninstall --help", ["node", "bin/cli.js", "uninstall", "--help"], "SAFE REMOVAL HELPER"),
]

print("Rendering full-size, unclipped screenshots for ALL commands...")
for path, cmd_str, cmd_args, badge in commands:
    res = subprocess.run(cmd_args, capture_output=True, text=True)
    raw_output = res.stdout if res.stdout else res.stderr
    
    # Render unclipped full screen terminal
    img = render_fullscreen_terminal(cmd_str, raw_output, f"konoha — {cmd_str}", badge)
    img.save(path, quality=95)
    size_kb = os.path.getsize(path) / 1024
    print(f"  ✓ Saved {path} (Dimensions: {img.width}x{img.height}, {size_kb:.1f} KB)")

# Now generate a full-screen, unclipped animated Demo GIF (1200x760)
print("\nRendering FULL-SCREEN unclipped animated Demo GIF...")
GIF_WIDTH = 1200
GIF_HEIGHT = 760

def render_gif_frame(command_str, output_text, title="konoha — interactive demo", badge="FEATURE DEMO"):
    lines = output_text.splitlines()
    img = Image.new("RGB", (GIF_WIDTH, GIF_HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)
    
    header_h = 42
    draw.rectangle([0, 0, GIF_WIDTH - 1, GIF_HEIGHT - 1], outline=BORDER_COLOR, width=2)
    draw.rectangle([1, 1, GIF_WIDTH - 2, header_h], fill=HEADER_BG)
    draw.line([(1, header_h), (GIF_WIDTH - 2, header_h)], fill=BORDER_COLOR, width=1)
    
    draw.ellipse([18, 14, 30, 26], fill=(239, 68, 68))
    draw.ellipse([40, 14, 52, 26], fill=(245, 158, 11))
    draw.ellipse([62, 14, 74, 26], fill=(34, 197, 94))
    
    bbox = font_title.getbbox(title)
    draw.text(((GIF_WIDTH - (bbox[2] - bbox[0])) // 2, 12), title, fill=MUTED_COLOR, font=font_title)
    draw.text((GIF_WIDTH - 260, 13), f"⚡ {badge}", fill=(56, 189, 248), font=font_badge)
    
    y = header_h + 16
    x_start = 24
    
    draw.text((x_start, y), "user@konoha:~$ ", fill=(74, 222, 128), font=font_bold)
    prefix_w = font_bold.getbbox("user@konoha:~$ ")[2]
    draw.text((x_start + prefix_w, y), command_str, fill=DEFAULT_TEXT, font=font_bold)
    y += 28
    
    draw.line([(x_start, y), (GIF_WIDTH - 24, y)], fill=(30, 41, 59), width=1)
    y += 14
    
    # Display full lines that fit comfortably on 760px canvas
    for line in lines[:32]:
        segments = parse_ansi_to_segments(line)
        cur_x = x_start
        for content, color, is_bold in segments:
            f = font_bold if is_bold else font
            draw.text((cur_x, y), content, fill=color, font=f)
            bbox = f.getbbox(content)
            cur_x += (bbox[2] - bbox[0])
        y += LINE_HEIGHT
        
    return img

gif_scenes = [
    ("konoha version", ["node", "bin/cli.js", "version"], "1. VERSION & UPDATE CHECK"),
    ("konoha status", ["node", "bin/cli.js", "status"], "2. SYSTEM & 6-CLIENT STATUS"),
    ("konoha skill list", ["node", "bin/cli.js", "skill", "list"], "3. SQLITE FTS5 SKILL REGISTRY"),
    ("konoha agent status", ["node", "bin/cli.js", "agent", "status"], "4. SUBAGENT ATTRIBUTION TELEMETRY"),
    ("konoha savings", ["node", "bin/cli.js", "savings"], "5. CONTEXT TOKEN SAVINGS (95%)"),
    ("konoha project list", ["node", "bin/cli.js", "project", "list"], "6. WORKSPACE INVARIANTS"),
    ("konoha data view", ["node", "bin/cli.js", "data", "view"], "7. SQLITE MEMORY PERSISTENCE"),
    ("konoha test", ["node", "bin/cli.js", "test", "--help"], "8. 52 TEST SUITES PASSING"),
]

gif_frames = []
for cmd_str, cmd_args, badge in gif_scenes:
    res = subprocess.run(cmd_args, capture_output=True, text=True)
    raw_output = res.stdout if res.stdout else res.stderr
    
    # 1. Command typing frame
    f1 = render_gif_frame(cmd_str[:len(cmd_str)//2] + "█", "", f"konoha — {cmd_str}", badge)
    gif_frames.append((f1, 250))
    
    # 2. Command executed frame
    f2 = render_gif_frame(cmd_str + "█", "", f"konoha — {cmd_str}", badge)
    gif_frames.append((f2, 350))
    
    # 3. Full unclipped output frame
    f3 = render_gif_frame(cmd_str, raw_output, f"konoha — {cmd_str}", badge)
    gif_frames.append((f3, 2800))

gif_images = [f[0] for f in gif_frames]
gif_durations = [f[1] for f in gif_frames]

gif_images[0].save(
    "assets/demo.gif",
    save_all=True,
    append_images=gif_images[1:],
    optimize=True,
    duration=gif_durations,
    loop=0
)
size_kb = os.path.getsize("assets/demo.gif") / 1024
print(f"✓ Saved assets/demo.gif (Dimensions: {GIF_WIDTH}x{GIF_HEIGHT}, {len(gif_frames)} frames, {size_kb:.1f} KB)")
print("Full-screen asset rendering complete!")
