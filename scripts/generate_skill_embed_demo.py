#!/usr/bin/env python3
"""
Generate 100% Authentic, Real Terminal Animated GIF for Konoha Skill & Agent Embed Flow.
Executes the exact 5-step workflow:
1. konoha skill search helm
2. konoha skill add helm-chart-scaffolding
3. konoha agent skill anbu
4. konoha skill helm-chart-scaffolding embed anbu
5. konoha migrate --force --yes
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_real_demo_gifs import (
    ROOT_DIR, ASSETS_DIR, render_terminal_frame, save_optimized_gif,
    build_scene_frames, execute_real_command
)

def main():
    print("=========================================================================")
    print("      KONOHA REAL DEMO: CREATE SKILL & EMBED INTO AGENT                  ")
    print("=========================================================================")
    print("Capturing 100% authentic terminal execution for 5-step workflow...\n")

    skill_flow_scenes = [
        (
            "konoha skill search helm",
            ["node", "bin/cli.js", "skill", "search", "helm"],
            "1. SKILL SEARCH • PUBLIC REGISTRY",
            None,
            False,
            ROOT_DIR,
            "~"
        ),
        (
            "konoha skill add helm-chart-scaffolding",
            ["node", "bin/cli.js", "skill", "add", "helm-chart-scaffolding"],
            "2. SKILL ADD • DLX SKILLS & FTS5 MIGRATE",
            None,
            True,
            ROOT_DIR,
            "~"
        ),
        (
            "konoha agent skill anbu",
            ["node", "bin/cli.js", "agent", "skill", "anbu"],
            "3. AGENT SKILL • ANBU SQUAD SOP",
            None,
            False,
            ROOT_DIR,
            "~"
        ),
        (
            "konoha skill helm-chart-scaffolding embed anbu",
            ["node", "bin/cli.js", "skill", "helm-chart-scaffolding", "embed", "anbu"],
            "4. EMBED SKILL • DIRECT AGENT INTEGRATION",
            None,
            False,
            ROOT_DIR,
            "~"
        ),
        (
            "konoha migrate --force --yes",
            ["node", "bin/cli.js", "migrate", "--force", "--yes"],
            "5. MIGRATE • 100% RE-INDEX & VECTOR CACHE",
            None,
            True,
            ROOT_DIR,
            "~"
        ),
    ]

    all_frames = []
    for cmd_str, cmd_args, badge, extra_env, scroll, cwd, pdir in skill_flow_scenes:
        print(f"  • Capturing real execution: {cmd_str}")
        frames = build_scene_frames(
            cmd_str, cmd_args, badge,
            title_prefix="konoha",
            extra_env=extra_env,
            scroll_steps=scroll,
            cwd=cwd,
            prompt_dir=pdir
        )
        all_frames.extend(frames)

    # Save to assets/demo-skill-embed.gif and assets/demo-skills.gif
    target_path = os.path.join(ASSETS_DIR, "demo-skill-embed.gif")
    save_optimized_gif(all_frames, target_path)

    target_path_skills = os.path.join(ASSETS_DIR, "demo-skills.gif")
    save_optimized_gif(all_frames, target_path_skills)

    print("\n✓ Real skill creation & embedding demo GIF generated successfully!")

if __name__ == "__main__":
    main()
