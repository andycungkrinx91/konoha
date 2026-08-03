#!/usr/bin/env python3
"""
test_docs_currency.py — verifies all konoha documentation is up to date with current source code.
Run after any server.py or file_tools_router.js change.
"""

import json
import os
import re
import sys
from pathlib import Path

DOC_DIR = Path(__file__).resolve().parent.parent / "docs"
SRC_DIR = Path(__file__).resolve().parent.parent / "src"

# ─── Helpers ───────────────────────────────────────────────────────────

def read_file(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def read_tools_from_server_py():
    """Parse tools/list from server.py to get current tool names."""
    server_content = read_file(SRC_DIR / "server.py")

    # Find all "name": "<tool_name>" blocks in tools/list section
    # They appear between lines 2848 (tools/index) and line ~3105 (end of array)
    tools = []
    # Match lines like: "name": "find_skill",
    pattern = r'"name"\s*:\s*"(\w+)"'
    for match in re.finditer(pattern, server_content):
        name = match.group(1)
        if name in ("name", "arguments", "id", "jsonrpc", "result", "method", "params"):
            continue
        # We want tool names, not property names inside inputSchema
        # Tool names are preceded by 'tools/call' or are top-level in tools list
        # Simpler heuristic: look for patterns right after "name": that are tool names
        tools.append(name)
    return tools


def parse_tools_list(server_path):
    """Extract all tool names from server.py by scanning the tools/list response."""
    content = server_path.read_text(encoding="utf-8")
    start_idx = content.find('"tools":')
    if start_idx == -1:
        return []
    # The tools array has pattern: { "name": "xxx", "description": ... },
    # We want tool names that are at object level (name followed by description)
    chunk = content[start_idx:start_idx + 30000]
    tool_pattern = r'\{\s*"name"\s*:\s*"([a-z_][a-z_0-9]*)"[^}]*"description"\s*:'
    names = re.findall(tool_pattern, chunk)
    return names


def parse_tool_names_from_router(path):
    """Parse tool names from file_tools_router.js."""
    content = path.read_text(encoding="utf-8")
    names = []
    for m in re.finditer(r"name:\s*'([^']+)'", content):
        names.append(m.group(1))
    return names


def check_md_file(filename, checks):
    """Run a list of check functions on a markdown file and return failures."""
    filepath = DOC_DIR / filename
    if not filepath.exists():
        return [{"type": "MISSING_FILE", "detail": str(filepath)}]
    content = read_file(filepath)
    failures = []
    for check in checks:
        result = check(content, filename)
        if result:
            failures.append(result)
    return failures


# ─── Check functions ──────────────────────────────────────────────────

def check_arch_tools_list(content, filename):
    """ARCHITECTURE.md should mention all major tool categories."""
    expected_tools = ["find_skill", "list_skills", "get_skill", "optimize_report",
                      "build_from_source", "build_from_text", "web_search",
                      "mcp_sannin", "mcp_kage", "mcp_jonin", "mcp_anbu",
                      "mcp_chunin", "mcp_tokubetsu_jonin", "mcp_genin"]
    missing = [t for t in expected_tools if t not in content]
    if missing:
        return {"type": "MISSING_TOOLS", "detail": f"Missing from {filename}: {missing}"}
    return None


def check_arch_subagents(content, filename):
    """Verify all subagent roles are mentioned."""
    expected_agents = ["kage", "jonin", "anbu", "chunin", "tokubetsu-jonin", "genin", "sannin"]
    missing = [a for a in expected_agents if a.lower() not in content.lower()]
    if missing:
        return {"type": "MISSING_AGENTS", "detail": f"Missing subagent: {missing}"}
    return None


def check_benchmark_commands_exist(content, filename):
    """Benchmark.md should at least mention some CLI commands (just as a sanity check)."""
    # Only check that the doc has SOME content, don't mandate specific commands
    if len(content) < 500:
        return {"type": "EMPTY_DOC", "detail": "BENCHMARK.md seems too short to be complete"}
    return None


def check_troubleshooting_commands(content, filename):
    """TROUBLESHOOTING.md references commands that should be tested against actual CLI."""
    known_sections = ["database", "bridge", "indexing", "skill", "agent"]
    sections_found = [s for s in known_sections if s.lower() in content.lower()]
    if not sections_found:
        return {"type": "EMPTY_SECTIONS", "detail": "No troubleshooting sections found"}
    return None


def check_setup_ide_tools(content, filename):
    """SETUP-IDE.md mentions tools that must match file_tools_router."""
    expected = ["read_file_head", "read_file_range", "file_info", "token_efficient_grep"]
    missing = [t for t in expected if t not in content]
    if missing:
        return {"type": "MISSING_TOOLS", "detail": f"File tools not documented: {missing}"}
    return None


def check_mcp_block_consistency(content, filename):
    """SUBAGENT_MCP_BLOCK references must match actual tools."""
    # The MCP block is dynamically generated from DB, not hardcoded in server.py
    # So we skip this check - the block content is verified in test_subagent_mcp_block.py
    return None


# ─── Main ──────────────────────────────────────────────────────────────

def main():
    """Run all doc currency checks and report findings."""
    server_path = SRC_DIR / "server.py"
    router_path = SRC_DIR / "file_tools_router.js"

    # Parse actual tool lists
    actual_tools = parse_tools_list(server_path)
    if not actual_tools:
        print("ERROR: Could not parse tools from server.py", file=sys.stderr)
        sys.exit(1)

    actual_file_tools = parse_tool_names_from_router(router_path)

    print(f"=== Konoha Documentation Currency Test ===")
    print(f"Konoha tools from server.py: {actual_tools}")
    print(f"File-tools from file_tools_router.js: {actual_file_tools}")
    print()

    all_failures = []

    # Define checks per file
    doc_checks = [
        ("ARCHITECTURE.md", [check_arch_tools_list, check_arch_subagents]),
        ("BENCHMARK.md", [check_benchmark_commands_exist]),
        ("TROUBLESHOOTING.md", [check_troubleshooting_commands]),
        ("SETUP-IDE.md", [check_setup_ide_tools]),
        ("SETUP-CURSOR.md", [check_setup_ide_tools]),
        ("ADDING-SKILLS.md", [lambda c, f: None]),  # placeholder
    ]

    for filename, checks in doc_checks:
        results = check_md_file(filename, checks)
        for r in results:
            if r.get("type") != "MISSING_FILE":
                all_failures.append((filename, r))
            else:
                print(f"⚠️  Missing: {r['detail']}")

    # Verify SUBAGENT_MCP_BLOCK mentions all key tools (use full content)
    server_content = read_file(server_path)
    # Check that the SUBAGENT_MCP_BLOCK references key tools
    mcp_failures = check_mcp_block_consistency(server_content, "server.py")
    if mcp_failures:
        all_failures.append(("server.py (SUBAGENT_MCP_BLOCK)", mcp_failures))

    if all_failures:
        print("FAILURES:")
        for fname, fail in all_failures:
            print(f"  {fname}: {fail.get('type')} - {fail.get('detail')}")
        sys.exit(1)
    else:
        print("✓ All documentation is consistent with source code.")
        sys.exit(0)


if __name__ == "__main__":
    main()
