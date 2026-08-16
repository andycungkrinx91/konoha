#!/usr/bin/env python3
"""Validate the developer-only maintenance skill contract across copies."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    ROOT / "src/templates/skills/konoha/SKILL.md",
    ROOT / ".agents/skills/konoha/SKILL.md",
    ROOT / ".cursor/skills/konoha/SKILL.md",
]

required = [
    "Konoha MCP",
    "Semble MCP",
    "RTK",
    "master",
    "andycungkrinx91.konoha-bridge-master-universal",
    "Konoha does not maintain filesystem mirrors",
    "all discovered tests pass",
]

for path in FILES:
    content = path.read_text(encoding="utf-8")
    missing = [item for item in required if item not in content]
    if missing:
        raise SystemExit(f"{path.relative_to(ROOT)} missing: {missing}")
    if "Cursor skills mirror" in content:
        raise SystemExit(f"{path.relative_to(ROOT)} still advertises a Cursor mirror gate")
    if "pinned to `v1.2.0`" in content:
        raise SystemExit(f"{path.relative_to(ROOT)} still advertises the obsolete bridge pin")

print("Maintenance skill contract and deployment copies passed.")
