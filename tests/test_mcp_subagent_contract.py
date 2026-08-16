#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / "src/templates/skills/konoha/references/mcp-tools-block.md"
deployed = ROOT / ".agents/skills/konoha/references/mcp-tools-block.md"

if not source.exists() or not deployed.exists():
    raise SystemExit("canonical and deployed MCP tool blocks must both exist")
if source.read_bytes() != deployed.read_bytes():
    raise SystemExit("canonical and deployed MCP tool blocks differ")

content = source.read_text(encoding="utf-8")
for phrase in ("Konoha is mandatory", "Semble is mandatory", "RTK is mandatory", "Resume safety", "mcp__semble__search", "mcp__konoha__find_skill"):
    if phrase not in content:
        raise SystemExit(f"MCP subagent contract missing: {phrase}")

print("Direct MCP subagent contract and source/deployed parity passed.")
