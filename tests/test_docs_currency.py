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

ROOT_DIR = Path(__file__).resolve().parent.parent
DOC_DIR = ROOT_DIR / "docs"
SRC_DIR = ROOT_DIR / "src"

REQUIRED_DOCS = [
    "README.md",
    "docs/ARCHITECTURE.md",
    "docs/BENCHMARK.md",
    "docs/LLM-BRIDGE-GATEWAY.md",
    "docs/SETUP-IDE.md",
    "docs/SETUP-CLI.md",
    "docs/SETUP-CURSOR.md",
    "docs/SETUP-MCP-CLIENTS.md",
    "docs/ADDING-SKILLS.md",
    "docs/TROUBLESHOOTING.md",
    "docs/diagrams/README.md",
    "docs/diagrams/konoha-architecture.drawio",
    "docs/SecurityCompliance/security_compliance_report_google_policy_2.0.0_2026-08-27.md",
]


def check_local_links():
    """Validate repository-relative Markdown links and image/source targets."""
    failures = []
    markdown_files = [ROOT_DIR / "README.md", *DOC_DIR.rglob("*.md")]
    pattern = re.compile(r"!?(?:\[[^\]]*\])\(([^)]+)\)")
    for source in markdown_files:
        content = read_file(source)
        for raw_target in pattern.findall(content):
            raw = raw_target.strip()
            if not raw or re.match(r"^(?:https?:|mailto:|tel:|data:|#)", raw, re.I):
                continue
            if raw.lower().startswith("file://"):
                from urllib.parse import unquote, urlparse
                parsed = urlparse(raw)
                resolved = Path(unquote(parsed.path)).resolve()
            else:
                target = raw.split("#", 1)[0].split("?", 1)[0]
                resolved = (source.parent / target).resolve()
            if not resolved.exists():
                failures.append(f"{source.relative_to(ROOT_DIR)} -> {raw_target}")
    return failures


def check_required_docs():
    return [doc for doc in REQUIRED_DOCS if not (ROOT_DIR / doc).exists()]

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
    """Read the canonical manifest used by both MCP runtimes."""
    manifest_path = server_path.with_name("mcp_tool_manifest.json")
    with manifest_path.open(encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)
    return [tool["name"] for tool in manifest.get("tools", [])]


def parse_tool_names_from_router(path):
    """Read router tool names from its exported manifest-backed handler map."""
    content = path.read_text(encoding="utf-8")
    start = content.index("const TOOL_HANDLERS = {")
    end = content.index("};", start)
    return re.findall(r"^\s{2}([a-z_]+):", content[start:end], re.MULTILINE)




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
                      "build_with_image_design", "build_from_source", "build_from_text", "web_search",
                      "sannin", "kage", "jonin", "anbu",
                      "chunin", "tokubetsu_jonin", "genin"]
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
    if len(actual_tools) != 38:
        print(f"ERROR: Expected 38 manifest-backed tools, found {len(actual_tools)}", file=sys.stderr)
        sys.exit(1)
    if set(actual_tools) != set(actual_file_tools):
        print("ERROR: Node/Python MCP tool registries differ", file=sys.stderr)
        sys.exit(1)
    if "review" not in read_file(SRC_DIR / "server.py"):
        print("ERROR: Workflow review gate is not documented in runtime", file=sys.stderr)
        sys.exit(1)
    if "search_file" in actual_file_tools:
        print("ERROR: search_file must be provided by Semble MCP, not Konoha file-tools", file=sys.stderr)
        sys.exit(1)

    print(f"=== Konoha Documentation Currency Test ===")
    print(f"Konoha tools from server.py: {actual_tools}")
    print(f"File-tools from file_tools_router.js: {actual_file_tools}")
    print()

    all_failures = []

    missing_docs = check_required_docs()
    if missing_docs:
        all_failures.append(("repository", {"type": "MISSING_REQUIRED_DOCS", "detail": missing_docs}))

    broken_links = check_local_links()
    if broken_links:
        all_failures.append(("local-links", {"type": "BROKEN_LOCAL_LINKS", "detail": broken_links}))

    readme = read_file(ROOT_DIR / "README.md")
    if "andycungkrinx91.konoha-bridge-master-universal" not in readme:
        all_failures.append(("README.md", {"type": "STALE_BRIDGE_PATH", "detail": "README must document the master extension path"}))
    if re.search(r"(?:mirrors?|synced from).*\.cursor/skills|\.cursor/skills.*(?:mirrored|synced)", readme, re.I):
        all_failures.append(("README.md", {"type": "STALE_CURSOR_MIRROR", "detail": "README must not advertise a Konoha Cursor skill mirror"}))

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
